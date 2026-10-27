"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const plugin = require(path.join(root, manifest.runtime.nodeEntry)).default;

function createLaunchContext(platform = "macos") {
  return {
    protocol: 2,
    plugin: manifest.plugin,
    host: { platform, version: "2.0.0", devMode: true },
    dirs: {
      root,
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
    },
    capabilities: [],
  };
}

async function setupPlugin(platform = "macos") {
  return plugin.setup(createLaunchContext(platform));
}

function createInput(trigger, kind = "text") {
  return {
    trigger,
    item: {
      id: "test-item",
      kind,
      tags: [],
      pinned: false,
      createdAt: 1,
      lastCopiedAt: 2,
      attachments: [],
    },
    content:
      kind === "text"
        ? { kind, text: "private clipboard text" }
        : { kind, width: 1, height: 1, format: "png", bytes: 68 },
  };
}

function createHost({ settings = {}, settingsError, logError } = {}) {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === "settings.get") {
      if (settingsError) throw settingsError;
      return { values: settings };
    }
    if (method === "log.write" && logError) throw logError;
    return {};
  };

  return {
    calls,
    ctx: {
      launch: createLaunchContext(),
      call,
      settings: { get: () => call("settings.get", {}) },
      log: { write: (params) => call("log.write", params) },
    },
  };
}

test("manifest and built runtime register exactly one detector, no UI or actions", async () => {
  const launchContext = createLaunchContext();

  const registry = await plugin.setup(launchContext);

  assert.deepEqual(
    Object.keys(registry.detectors),
    manifest.detectors.map(({ id }) => id),
  );
  assert.deepEqual(manifest.detectors[0].inputKinds, ["text", "image"]);
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.renderers, undefined);
  assert.equal(manifest.writes, undefined);
});

for (const trigger of ["copy", "recopy"]) {
  for (const kind of ["text", "image"]) {
    test(`${kind} ${trigger} plays the bundled sound quietly`, async (t) => {
      const playback = t.mock.method(
        childProcess,
        "execFile",
        (_command, _args, _options, callback) => {
          callback(null);
        },
      );
      const { detectors } = await setupPlugin();
      const { ctx, calls } = createHost();
      const input = createInput(trigger, kind);

      await detectors["copy-sound"](input, ctx);

      assert.equal(playback.mock.callCount(), 1);
      assert.deepEqual(playback.mock.calls[0].arguments.slice(0, 3), [
        "/usr/bin/afplay",
        ["-v", "0.25", path.join(root, "assets", "click.aiff")],
        { timeout: 1000, maxBuffer: 16 * 1024 },
      ]);
      assert.deepEqual(calls, [{ method: "settings.get", params: {} }]);
    });
  }
}

const silentCases = [
  { platform: "macos", trigger: "edit" },
  { platform: "macos", trigger: "manual" },
  { platform: "windows", trigger: "copy" },
  { platform: "windows", trigger: "recopy" },
];

for (const { platform, trigger } of silentCases) {
  test(`${platform} ${trigger} does not start playback`, async (t) => {
    const playback = t.mock.method(
      childProcess,
      "execFile",
      (_command, _args, _options, callback) => {
        callback(null);
      },
    );
    const { detectors } = await setupPlugin(platform);
    const { ctx, calls } = createHost();
    const input = createInput(trigger);

    await detectors["copy-sound"](input, ctx);

    assert.equal(playback.mock.callCount(), 0);
    assert.deepEqual(calls, []);
  });
}

test("playback is awaited before the detector returns", async (t) => {
  let finishPlayback;
  let notifyPlaybackStarted;
  let completed = false;
  const playbackStarted = new Promise((resolve) => {
    notifyPlaybackStarted = resolve;
  });
  t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      finishPlayback = callback;
      notifyPlaybackStarted();
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx } = createHost();
  const input = createInput("copy");

  const pending = detectors["copy-sound"](input, ctx).then(() => {
    completed = true;
  });
  await playbackStarted;
  const completedBeforePlayback = completed;
  finishPlayback(null);
  await pending;

  assert.equal(completedBeforePlayback, false);
  assert.equal(completed, true);
});

for (const failureMode of ["callback error", "synchronous exception"]) {
  test(`${failureMode} is logged safely and the next copy retries`, async (t) => {
    const error = new Error("private clipboard text must not appear in a log");
    const playback = t.mock.method(
      childProcess,
      "execFile",
      (_command, _args, _options, callback) => {
        if (failureMode === "synchronous exception") throw error;
        callback(error);
      },
    );
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost();
    const copy = createInput("copy");
    const recopy = createInput("recopy");

    await detectors["copy-sound"](copy, ctx);
    await detectors["copy-sound"](recopy, ctx);
    const logCalls = calls.filter(({ method }) => method === "log.write");

    assert.equal(playback.mock.callCount(), 2);
    assert.equal(
      calls.filter(({ method }) => method === "settings.get").length,
      2,
    );
    assert.equal(logCalls.length, 2);
    for (const { method, params } of logCalls) {
      assert.equal(method, "log.write");
      assert.equal(params.level, "warn");
      assert.match(params.message, /could not play/);
      assert.ok(!params.message.includes(copy.content.text));
    }
  });
}

test("sound is a bundled nonempty AIFF file", () => {
  const soundPath = path.join(root, "assets", "click.aiff");

  const sound = readFileSync(soundPath);

  assert.equal(sound.toString("ascii", 0, 4), "FORM");
  assert.equal(sound.toString("ascii", 8, 12), "AIFF");
  assert.ok(sound.length > 512);
});

const defaultSoundPath = path.join(root, "assets", "click.aiff");
const configurationCases = [
  {
    name: "absolute paths preserve spaces and shell characters",
    settings: {
      soundPath: "/Users/example/Sounds/copy 'click';.wav",
      volume: 0.6,
    },
    expectedPath: "/Users/example/Sounds/copy 'click';.wav",
    expectedVolume: "0.6",
  },
  {
    name: "home-relative paths expand to the home directory",
    settings: { soundPath: "~/Sounds/copy.aiff" },
    expectedPath: path.join(homedir(), "Sounds", "copy.aiff"),
  },
  {
    name: "the bundled path can be configured explicitly",
    settings: { soundPath: defaultSoundPath },
  },
  {
    name: "relative paths use the bundled sound",
    settings: { soundPath: "Sounds/copy.wav" },
  },
  {
    name: "file URLs use the bundled sound",
    settings: { soundPath: "file:///Users/example/copy.wav" },
  },
  {
    name: "empty paths use the bundled sound",
    settings: { soundPath: "" },
  },
  {
    name: "non-string paths use the bundled sound",
    settings: { soundPath: 42 },
  },
  {
    name: "null paths use the bundled sound",
    settings: { soundPath: null },
  },
  {
    name: "paths with null bytes use the bundled sound",
    settings: { soundPath: "/Users/example/copy\0.wav" },
  },
  {
    name: "volume can change without a custom sound",
    settings: { volume: 0.5 },
    expectedVolume: "0.5",
  },
  {
    name: "full volume is accepted",
    settings: { volume: 1 },
    expectedVolume: "1",
  },
  ...["0.5", null, -1, 2, NaN, Infinity].map((volume) => ({
    name: `invalid volume ${String(volume)} (${typeof volume}) uses default gain`,
    settings: { volume },
  })),
];

for (const {
  name,
  settings,
  expectedPath = defaultSoundPath,
  expectedVolume = "0.25",
} of configurationCases) {
  test(name, async (t) => {
    const playback = t.mock.method(
      childProcess,
      "execFile",
      (_command, _args, _options, callback) => {
        callback(null);
      },
    );
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({ settings });
    const input = createInput("copy");

    await detectors["copy-sound"](input, ctx);

    assert.equal(playback.mock.callCount(), 1);
    assert.deepEqual(playback.mock.calls[0].arguments.slice(0, 3), [
      "/usr/bin/afplay",
      ["-v", expectedVolume, expectedPath],
      { timeout: 1000, maxBuffer: 16 * 1024 },
    ]);
    assert.deepEqual(calls, [{ method: "settings.get", params: {} }]);
  });
}

test("zero volume skips playback", async (t) => {
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      callback(null);
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({ settings: { volume: 0 } });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);

  assert.equal(playback.mock.callCount(), 0);
  assert.deepEqual(calls, [{ method: "settings.get", params: {} }]);
});

test("failed custom playback falls back to the bundled sound at the configured volume", async (t) => {
  const customSoundPath = "/Users/example/private/custom.wav";
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, args, _options, callback) => {
      callback(args[2] === customSoundPath ? new Error(customSoundPath) : null);
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath: customSoundPath, volume: 0.4 },
  });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);
  const logCalls = calls.filter(({ method }) => method === "log.write");

  assert.deepEqual(
    playback.mock.calls.map(({ arguments: args }) => args[1]),
    [
      ["-v", "0.4", customSoundPath],
      ["-v", "0.4", defaultSoundPath],
    ],
  );
  assert.ok(
    playback.mock.calls.reduce(
      (total, { arguments: args }) => total + args[2].timeout,
      0,
    ) < 3000,
  );
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].params.level, "warn");
  assert.match(logCalls[0].params.message, /bundled click/);
  assert.ok(!logCalls[0].params.message.includes(customSoundPath));
});

test("failure of both sounds is logged without rejecting the detector", async (t) => {
  const error = new Error("private clipboard text");
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      callback(error);
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath: "/Users/example/custom.wav" },
  });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);
  const logCalls = calls.filter(({ method }) => method === "log.write");

  assert.equal(playback.mock.callCount(), 2);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].params.level, "warn");
  assert.match(logCalls[0].params.message, /could not play/);
  assert.ok(!logCalls[0].params.message.includes(input.content.text));
});

test("unavailable settings use the bundled sound and default volume", async (t) => {
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      callback(null);
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settingsError: new Error("private settings error"),
  });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);
  const logCalls = calls.filter(({ method }) => method === "log.write");

  assert.equal(playback.mock.callCount(), 1);
  assert.deepEqual(playback.mock.calls[0].arguments[1], [
    "-v",
    "0.25",
    defaultSoundPath,
  ]);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].params.level, "warn");
  assert.match(logCalls[0].params.message, /could not read its settings/);
  assert.ok(!logCalls[0].params.message.includes("private settings error"));
});

test("settings are read again on the next copy", async (t) => {
  const settings = { soundPath: "/Users/example/first.wav", volume: 0.2 };
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      callback(null);
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx } = createHost({ settings });
  const copy = createInput("copy");
  const recopy = createInput("recopy");

  await detectors["copy-sound"](copy, ctx);
  settings.soundPath = "/Users/example/second.wav";
  settings.volume = 0.7;
  await detectors["copy-sound"](recopy, ctx);

  assert.deepEqual(
    playback.mock.calls.map(({ arguments: args }) => args[1]),
    [
      ["-v", "0.2", "/Users/example/first.wav"],
      ["-v", "0.7", "/Users/example/second.wav"],
    ],
  );
});

test("logging failures do not reject the detector", async (t) => {
  const playback = t.mock.method(
    childProcess,
    "execFile",
    (_command, _args, _options, callback) => {
      callback(new Error("Audio output unavailable"));
    },
  );
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settingsError: new Error("Settings unavailable"),
    logError: new Error("Log unavailable"),
  });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);

  assert.equal(playback.mock.callCount(), 1);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["settings.get", "log.write", "log.write"],
  );
});
