"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PLUGIN_SOUND_LIMITS } = require("@clipbus/plugin-sdk");

const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const plugin = require(path.join(root, manifest.runtime.nodeEntry)).default;
const defaultSoundPath = "package/assets/click.wav";

function createLaunchContext(platform = "macos", supported = true) {
  return {
    protocol: 2,
    plugin: manifest.plugin,
    host: { platform, version: "3.2.1", devMode: true },
    dirs: {
      root,
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
    },
    capabilities: supported ? ["system.playSound"] : [],
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

function hostError(name) {
  return Object.assign(new Error("private host failure"), { name });
}

function createHost({
  settings = {},
  settingsError,
  logError,
  playback = async () => ({}),
  supported = true,
} = {}) {
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === "settings.get") {
      if (settingsError) throw settingsError;
      return { values: settings };
    }
    if (method === "system.playSound") return playback(params);
    if (method === "log.write" && logError) throw logError;
    return {};
  };

  return {
    calls,
    ctx: {
      launch: createLaunchContext("macos", supported),
      call,
      capabilities: { has: (name) => supported && name === "system.playSound" },
      system: { playSound: (params) => call("system.playSound", params) },
      settings: { get: () => call("settings.get", {}) },
      log: { write: (params) => call("log.write", params) },
    },
  };
}

function soundCalls(calls) {
  return calls
    .filter(({ method }) => method === "system.playSound")
    .map(({ params }) => params);
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
  assert.equal(manifest.permissions, undefined);
});

for (const trigger of ["copy", "recopy"]) {
  for (const kind of ["text", "image"]) {
    test(`${kind} ${trigger} requests the bundled sound quietly through the Host`, async () => {
      const { detectors } = await setupPlugin();
      const { ctx, calls } = createHost();
      const input = createInput(trigger, kind);

      await detectors["copy-sound"](input, ctx);

      assert.deepEqual(calls, [
        { method: "settings.get", params: {} },
        {
          method: "system.playSound",
          params: { path: defaultSoundPath, volume: 25 },
        },
      ]);
    });
  }
}

for (const { platform, trigger } of [
  { platform: "macos", trigger: "edit" },
  { platform: "macos", trigger: "manual" },
  { platform: "windows", trigger: "copy" },
  { platform: "windows", trigger: "recopy" },
]) {
  test(`${platform} ${trigger} does not request playback`, async () => {
    const { detectors } = await setupPlugin(platform);
    const { ctx, calls } = createHost();
    const input = createInput(trigger);

    await detectors["copy-sound"](input, ctx);

    assert.deepEqual(calls, []);
  });
}

test("Hosts without the sound capability are skipped without settings reads", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({ supported: false });
  const input = createInput("copy");

  await detectors["copy-sound"](input, ctx);

  assert.deepEqual(calls, []);
});

test("the playback-start response is awaited before the detector returns", async () => {
  let finishPlayback;
  let notifyPlaybackStarted;
  let completed = false;
  const playbackStarted = new Promise((resolve) => {
    notifyPlaybackStarted = resolve;
  });
  const { detectors } = await setupPlugin();
  const { ctx } = createHost({
    playback: () =>
      new Promise((resolve) => {
        finishPlayback = resolve;
        notifyPlaybackStarted();
      }),
  });
  const input = createInput("copy");

  const pending = detectors["copy-sound"](input, ctx).then(() => {
    completed = true;
  });
  await playbackStarted;
  const completedBeforePlayback = completed;
  finishPlayback({});
  await pending;

  assert.equal(completedBeforePlayback, false);
  assert.equal(completed, true);
});

for (const failureMode of ["rejected response", "synchronous exception"]) {
  test(`${failureMode} is logged safely and the next copy retries`, async () => {
    const error = new Error("private clipboard text must not appear in a log");
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({
      playback: () => {
        if (failureMode === "synchronous exception") throw error;
        return Promise.reject(error);
      },
    });

    await detectors["copy-sound"](createInput("copy"), ctx);
    await detectors["copy-sound"](createInput("recopy"), ctx);
    const logs = calls.filter(({ method }) => method === "log.write");

    assert.equal(soundCalls(calls).length, 2);
    assert.equal(logs.length, 2);
    for (const { params } of logs) {
      assert.equal(params.level, "warn");
      assert.match(params.message, /could not play/);
      assert.ok(!params.message.includes(error.message));
    }
  });
}

test("the bundled WAV is PCM16 within the Host sound limits", () => {
  const sound = readFileSync(path.join(root, "assets", "click.wav"));
  const chunks = new Map();

  for (let offset = 12; offset + 8 <= sound.length;) {
    const size = sound.readUInt32LE(offset + 4);
    chunks.set(
      sound.toString("ascii", offset, offset + 4),
      sound.subarray(offset + 8, offset + 8 + size),
    );
    offset += 8 + size + (size % 2);
  }
  const format = chunks.get("fmt ");
  const samples = chunks.get("data");
  const sampleRate = format.readUInt32LE(4);
  const duration = (samples.length / format.readUInt32LE(8)) * 1000;

  assert.equal(sound.toString("ascii", 0, 4), "RIFF");
  assert.equal(sound.toString("ascii", 8, 12), "WAVE");
  assert.equal(format.readUInt16LE(0), 1);
  assert.equal(format.readUInt16LE(14), 16);
  assert.ok([1, 2].includes(format.readUInt16LE(2)));
  assert.ok(sampleRate >= PLUGIN_SOUND_LIMITS.minimumSampleRate);
  assert.ok(sampleRate <= PLUGIN_SOUND_LIMITS.maximumSampleRate);
  assert.ok(duration > 0 && duration <= PLUGIN_SOUND_LIMITS.maximumDurationMs);
  assert.ok(sound.length <= PLUGIN_SOUND_LIMITS.maximumFileBytes);
});

const configurationCases = [
  {
    name: "package paths preserve spaces and shell characters",
    settings: { soundPath: "package/assets/copy 'click';.wav", volume: 0.6 },
    expectedPath: "package/assets/copy 'click';.wav",
    expectedVolume: 60,
  },
  {
    name: "the bundled path can be configured explicitly",
    settings: { soundPath: defaultSoundPath },
  },
  {
    name: "package paths preserve printable Unicode characters",
    settings: { soundPath: "package/assets/café-音.wav" },
    expectedPath: "package/assets/café-音.wav",
  },
  {
    name: "absolute paths migrate to the bundled sound",
    settings: { soundPath: "/Users/example/Sounds/copy.wav" },
  },
  {
    name: "home-relative paths migrate to the bundled sound",
    settings: { soundPath: "~/Sounds/copy.aiff" },
  },
  ...[
    "Sounds/copy.wav",
    "file:///Users/example/copy.wav",
    "",
    42,
    null,
    "package/assets/copy\0.wav",
    "package/assets/copy\n.wav",
    "package/assets/copy\x7f.wav",
    `package/assets/copy${String.fromCodePoint(0x85)}.wav`,
    "package/../copy.wav",
    "package/assets/./copy.wav",
    "package//copy.wav",
    "package/",
    "package/assets\\copy.wav",
    "data/copy.wav",
    "cache/copy.wav",
    `package/${"é".repeat(600)}.wav`,
  ].map((soundPath) => ({
    name: `invalid path ${JSON.stringify(soundPath).slice(0, 80)} uses the bundled sound`,
    settings: { soundPath },
  })),
  {
    name: "volume can change without a custom sound",
    settings: { volume: 0.5 },
    expectedVolume: 50,
  },
  {
    name: "full volume is accepted",
    settings: { volume: 1 },
    expectedVolume: 100,
  },
  {
    name: "fractional percentages are rounded",
    settings: { volume: 0.256 },
    expectedVolume: 26,
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
  expectedVolume = 25,
} of configurationCases) {
  test(name, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({ settings });

    await detectors["copy-sound"](createInput("copy"), ctx);

    assert.deepEqual(soundCalls(calls), [
      { path: expectedPath, volume: expectedVolume },
    ]);
    assert.equal(calls.length, 2);
  });
}

for (const volume of [0, 0.004]) {
  test(`volume ${volume} skips playback without consuming the Host slot`, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({ settings: { volume } });

    await detectors["copy-sound"](createInput("copy"), ctx);

    assert.deepEqual(calls, [{ method: "settings.get", params: {} }]);
  });
}

for (const name of ["PluginLimitExceeded", "PluginCapabilityUnsupported"]) {
  test(`${name} skips playback without logging or retrying a custom sound`, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({
      settings: { soundPath: "package/assets/custom.wav" },
      playback: async () => {
        throw hostError(name);
      },
    });

    await detectors["copy-sound"](createInput("copy"), ctx);
    await detectors["copy-sound"](createInput("recopy"), ctx);

    assert.deepEqual(
      soundCalls(calls),
      Array(2).fill({ path: "package/assets/custom.wav", volume: 25 }),
    );
    assert.equal(
      calls.filter(({ method }) => method === "log.write").length,
      0,
    );
  });
}

test("a rejected custom sound falls back on the next copy, not during cooldown", async () => {
  const customPath = "package/assets/private-custom.wav";
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath: customPath, volume: 0.4 },
    playback: async ({ path }) => {
      if (path === customPath) throw hostError("PluginResourceRejected");
      return {};
    },
  });

  await detectors["copy-sound"](createInput("copy"), ctx);
  const callsAfterFailure = soundCalls(calls).length;
  await detectors["copy-sound"](createInput("recopy"), ctx);
  const logs = calls.filter(({ method }) => method === "log.write");

  assert.equal(callsAfterFailure, 1);
  assert.deepEqual(soundCalls(calls), [
    { path: customPath, volume: 40 },
    { path: defaultSoundPath, volume: 40 },
  ]);
  assert.equal(logs.length, 1);
  assert.match(logs[0].params.message, /next copy/);
  assert.ok(!logs[0].params.message.includes(customPath));
});

test("failure of the custom and fallback sounds stays nonfatal and private", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath: "package/assets/custom.wav" },
    playback: async () => {
      throw hostError("PluginResourceRejected");
    },
  });

  await detectors["copy-sound"](createInput("copy"), ctx);
  await detectors["copy-sound"](createInput("recopy"), ctx);
  const logs = calls.filter(({ method }) => method === "log.write");

  assert.deepEqual(soundCalls(calls), [
    { path: "package/assets/custom.wav", volume: 25 },
    { path: defaultSoundPath, volume: 25 },
  ]);
  assert.equal(logs.length, 2);
  assert.match(logs[1].params.message, /could not play/);
  assert.ok(
    logs.every(
      ({ params }) => !params.message.includes("private host failure"),
    ),
  );
});

test("unavailable settings use the bundled sound and default volume", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settingsError: new Error("private settings error"),
  });

  await detectors["copy-sound"](createInput("copy"), ctx);
  const logs = calls.filter(({ method }) => method === "log.write");

  assert.deepEqual(soundCalls(calls), [{ path: defaultSoundPath, volume: 25 }]);
  assert.equal(logs.length, 1);
  assert.match(logs[0].params.message, /could not read its settings/);
  assert.ok(!logs[0].params.message.includes("private settings error"));
});

test("settings are read again on the next copy", async () => {
  const settings = { soundPath: "package/assets/first.wav", volume: 0.2 };
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({ settings });

  await detectors["copy-sound"](createInput("copy"), ctx);
  settings.soundPath = "package/assets/second.wav";
  settings.volume = 0.7;
  await detectors["copy-sound"](createInput("recopy"), ctx);

  assert.deepEqual(soundCalls(calls), [
    { path: "package/assets/first.wav", volume: 20 },
    { path: "package/assets/second.wav", volume: 70 },
  ]);
});

test("changing a rejected custom path lets the new sound play", async () => {
  const settings = { soundPath: "package/assets/bad.wav" };
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings,
    playback: async ({ path }) => {
      if (path === "package/assets/bad.wav")
        throw hostError("PluginResourceRejected");
      return {};
    },
  });

  await detectors["copy-sound"](createInput("copy"), ctx);
  settings.soundPath = "package/assets/good.wav";
  await detectors["copy-sound"](createInput("recopy"), ctx);

  assert.deepEqual(
    soundCalls(calls).map(({ path }) => path),
    ["package/assets/bad.wav", "package/assets/good.wav"],
  );
});

test("logging failures do not reject the detector", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settingsError: new Error("Settings unavailable"),
    logError: new Error("Log unavailable"),
    playback: async () => {
      throw new Error("Audio output unavailable");
    },
  });

  await detectors["copy-sound"](createInput("copy"), ctx);

  assert.deepEqual(
    calls.map(({ method }) => method),
    ["settings.get", "log.write", "system.playSound", "log.write"],
  );
});
