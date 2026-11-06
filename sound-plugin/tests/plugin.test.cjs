"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const plugin = require(path.join(root, manifest.runtime.nodeEntry)).default;
const defaultSoundPath = "package/assets/click.wav";

function createLaunchContext(platform = "macos", supported = true) {
  return {
    protocol: 2,
    plugin: manifest.plugin,
    host: { platform, version: "3.1.0", devMode: true },
    dirs: {
      root,
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
    },
    capabilities: supported ? ["system.playSound"] : [],
  };
}

async function setupPlugin(platform = "macos", supported = true) {
  return plugin.setup(createLaunchContext(platform, supported));
}

function createInput(trigger, kind = "text") {
  return {
    trigger,
    item: {
      id: "test-item", kind, tags: [], pinned: false,
      createdAt: 1, lastCopiedAt: 2, attachments: [],
    },
    content: kind === "text"
      ? { kind, text: "private clipboard text" }
      : { kind, width: 1, height: 1, format: "png", bytes: 68 },
  };
}

function createHost({
  settings = {}, settingsError, logError, playSound,
  platform = "macos", supported = true,
} = {}) {
  const calls = [];
  const launch = createLaunchContext(platform, supported);
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === "settings.get") {
      if (settingsError) throw settingsError;
      return { values: settings };
    }
    if (method === "system.playSound" && playSound) return playSound(params);
    if (method === "log.write" && logError) throw logError;
    return {};
  };
  return {
    calls,
    ctx: {
      launch,
      capabilities: { has: (method) => launch.capabilities.includes(method) },
      settings: { get: () => call("settings.get", {}) },
      system: { playSound: (params) => call("system.playSound", params) },
      log: { write: (params) => call("log.write", params) },
    },
  };
}

function sounds(calls) {
  return calls.filter(({ method }) => method === "system.playSound").map(({ params }) => params.path);
}

function warnings(calls) {
  return calls.filter(({ method }) => method === "log.write").map(({ params }) => params);
}

function hostError(name) {
  return Object.assign(new Error("private error details"), { name });
}

test("manifest and built runtime register exactly one detector, no UI or actions", async () => {
  const registry = await setupPlugin();
  assert.deepEqual(Object.keys(registry.detectors), manifest.detectors.map(({ id }) => id));
  assert.deepEqual(manifest.detectors[0].inputKinds, ["text", "image"]);
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.renderers, undefined);
  assert.equal(manifest.writes, undefined);
});

for (const trigger of ["copy", "recopy"]) {
  for (const kind of ["text", "image"]) {
    test(kind + " " + trigger + " requests the packaged click from the Host", async () => {
      const { detectors } = await setupPlugin();
      const { ctx, calls } = createHost();
      await detectors["copy-sound"](createInput(trigger, kind), ctx);
      assert.deepEqual(calls, [
        { method: "settings.get", params: {} },
        { method: "system.playSound", params: { path: defaultSoundPath } },
      ]);
    });
  }
}

for (const platform of ["macos", "windows"]) {
  for (const trigger of ["edit", "manual"]) {
    test(platform + " " + trigger + " stays silent", async () => {
      const { detectors } = await setupPlugin(platform);
      const { ctx, calls } = createHost({ platform });
      await detectors["copy-sound"](createInput(trigger), ctx);
      assert.deepEqual(calls, []);
    });
  }
  test(platform + " without the sound capability is skipped", async () => {
    const { detectors } = await setupPlugin(platform, false);
    const { ctx, calls } = createHost({ platform, supported: false });
    await detectors["copy-sound"](createInput("copy"), ctx);
    assert.deepEqual(calls, []);
  });
}

test("capability support, rather than a platform whitelist, controls playback", async () => {
  const { detectors } = await setupPlugin("windows");
  const { ctx, calls } = createHost({ platform: "windows" });
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), [defaultSoundPath]);
});

test("the detector awaits Host admission before returning", async () => {
  let finish;
  let started;
  let completed = false;
  const soundStarted = new Promise((resolve) => { started = resolve; });
  const { ctx } = createHost({
    playSound: () => new Promise((resolve) => { finish = resolve; started(); }),
  });
  const { detectors } = await setupPlugin();
  const pending = detectors["copy-sound"](createInput("copy"), ctx).then(() => { completed = true; });
  await soundStarted;
  assert.equal(completed, false);
  finish({});
  await pending;
  assert.equal(completed, true);
});

const configurationCases = [
  { name: "packaged custom sounds preserve spaces and shell characters", settings: { soundPath: "package/assets/copy 'click';.wav" }, expectedPath: "package/assets/copy 'click';.wav" },
  { name: "the bundled path can be configured explicitly", settings: { soundPath: defaultSoundPath } },
  ...[
    "/Users/example/copy.wav", "~/Sounds/copy.aiff", "assets/copy.wav",
    "file:///Users/example/copy.wav", "https://example.com/copy.wav",
    "data/copy.wav", "cache/copy.wav", "package/../copy.wav",
    "package/assets/../copy.wav", "package//copy.wav", "package/./copy.wav",
    "package/assets/copy\\click.wav", "package/assets/copy\0.wav",
    "package/assets/copy\n.wav", "package/", "", 42, null,
    "package/" + "声".repeat(400) + ".wav",
  ].map((soundPath) => ({
    name: "invalid or external path falls back: " + JSON.stringify(soundPath).slice(0, 80),
    settings: { soundPath },
  })),
  ...[0.25, 0.6, 1, "0.5", null, -1, 2, NaN, Infinity].map((volume) => ({
    name: "legacy positive or invalid volume uses the pre-attenuated click: " + String(volume),
    settings: { volume },
  })),
  { name: "a non-boolean enabled value does not mute", settings: { enabled: "false" } },
];

for (const { name, settings, expectedPath = defaultSoundPath } of configurationCases) {
  test(name, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({ settings });
    await detectors["copy-sound"](createInput("copy"), ctx);
    assert.deepEqual(sounds(calls), [expectedPath]);
    assert.deepEqual(warnings(calls), []);
  });
}

for (const settings of [{ enabled: false }, { volume: 0 }, { enabled: true, volume: 0 }]) {
  test("mute setting skips playback: " + JSON.stringify(settings), async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({ settings });
    await detectors["copy-sound"](createInput("copy"), ctx);
    assert.deepEqual(calls, [{ method: "settings.get", params: {} }]);
  });
}

for (const soundPath of [defaultSoundPath, "package/assets/custom.wav"]) {
  test("a busy Host skips without retry or fallback: " + soundPath, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({
      settings: { soundPath },
      playSound: () => { throw hostError("PluginLimitExceeded"); },
    });
    await detectors["copy-sound"](createInput("copy"), ctx);
    assert.deepEqual(sounds(calls), [soundPath]);
    assert.deepEqual(warnings(calls), []);
  });
}

test("failed custom playback falls back to the bundled click without logging the custom path", async () => {
  const soundPath = "package/assets/private-custom.wav";
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath },
    playSound: ({ path: requested }) => {
      if (requested === soundPath) throw hostError("PluginResourceRejected");
      return {};
    },
  });
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), [soundPath, defaultSoundPath]);
  assert.equal(warnings(calls).length, 1);
  assert.match(warnings(calls)[0].message, /bundled click/);
  assert.ok(!warnings(calls)[0].message.includes(soundPath));
});

test("a busy fallback is also skipped without warning or retry", async () => {
  const soundPath = "package/assets/custom.wav";
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settings: { soundPath },
    playSound: ({ path: requested }) => {
      throw hostError(requested === soundPath ? "PluginResourceRejected" : "PluginLimitExceeded");
    },
  });
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), [soundPath, defaultSoundPath]);
  assert.deepEqual(warnings(calls), []);
});

for (const soundPath of [defaultSoundPath, "package/assets/custom.wav"]) {
  test("resource failures are logged safely and the next copy can try again: " + soundPath, async () => {
    const { detectors } = await setupPlugin();
    const { ctx, calls } = createHost({
      settings: { soundPath },
      playSound: () => { throw hostError("PluginResourceRejected"); },
    });
    for (const trigger of ["copy", "recopy"]) {
      await detectors["copy-sound"](createInput(trigger), ctx);
    }
    assert.equal(sounds(calls).length, soundPath === defaultSoundPath ? 2 : 4);
    assert.equal(warnings(calls).length, 2);
    for (const warning of warnings(calls)) {
      assert.equal(warning.level, "warn");
      assert.match(warning.message, /could not start/);
      assert.ok(!warning.message.includes("private"));
      assert.ok(!warning.message.includes(soundPath));
    }
  });
}

test("unavailable settings use the bundled click without exposing error details", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({ settingsError: new Error("private settings error") });
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), [defaultSoundPath]);
  assert.equal(warnings(calls).length, 1);
  assert.match(warnings(calls)[0].message, /could not read its settings/);
  assert.ok(!warnings(calls)[0].message.includes("private"));
});

test("settings are read again on the next copy", async () => {
  const settings = { soundPath: "package/assets/first.wav", enabled: true };
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({ settings });
  await detectors["copy-sound"](createInput("copy"), ctx);
  settings.soundPath = "package/assets/second.wav";
  await detectors["copy-sound"](createInput("recopy"), ctx);
  settings.enabled = false;
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), ["package/assets/first.wav", "package/assets/second.wav"]);
});

test("logging failures do not reject the detector", async () => {
  const { detectors } = await setupPlugin();
  const { ctx, calls } = createHost({
    settingsError: new Error("Settings unavailable"),
    logError: new Error("Log unavailable"),
    playSound: () => { throw new Error("Audio output unavailable"); },
  });
  await detectors["copy-sound"](createInput("copy"), ctx);
  assert.deepEqual(sounds(calls), [defaultSoundPath]);
  assert.equal(warnings(calls).length, 2);
});

test("the bundled audio is PCM16 RIFF/WAVE within the Host sound limits", async () => {
  const { PLUGIN_SOUND_LIMITS: limits } = await import("@clipbus/plugin-sdk");
  const audio = readFileSync(path.join(root, "assets/click.wav"));
  assert.equal(audio.toString("ascii", 0, 4), "RIFF");
  assert.equal(audio.toString("ascii", 8, 12), "WAVE");
  assert.equal(audio.readUInt32LE(4) + 8, audio.length);
  assert.ok(audio.length <= limits.maximumFileBytes);
  let format;
  let dataBytes = 0;
  let chunks = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= audio.length);
    if (id === "fmt ") format = audio.subarray(start, start + size);
    if (id === "data") dataBytes += size;
    offset = start + size + (size % 2);
    chunks++;
  }
  assert.ok(chunks <= limits.maximumChunks);
  assert.ok(format && format.length >= 16);
  assert.equal(format.readUInt16LE(0), 1);
  const channels = format.readUInt16LE(2);
  const rate = format.readUInt32LE(4);
  const blockAlign = format.readUInt16LE(12);
  assert.ok(channels === 1 || channels === 2);
  assert.ok(rate >= limits.minimumSampleRate && rate <= limits.maximumSampleRate);
  assert.equal(format.readUInt16LE(14), 16);
  assert.equal(blockAlign, channels * 2);
  assert.equal(format.readUInt32LE(8), rate * blockAlign);
  assert.ok(dataBytes > 0 && dataBytes % blockAlign === 0);
  assert.ok(dataBytes / blockAlign / rate * 1000 <= limits.maximumDurationMs);
});
