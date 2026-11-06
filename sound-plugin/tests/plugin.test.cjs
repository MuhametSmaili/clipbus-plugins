"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const plugin = require(path.join(root, manifest.runtime.nodeEntry)).default;
const defaultPath = "package/assets/click.wav";

function launch(platform = "macos", supported = true) {
  return {
    protocol: 2,
    plugin: manifest.plugin,
    host: { platform, version: "test", devMode: true },
    dirs: { root, data: path.join(root, "data"), cache: path.join(root, "cache") },
    capabilities: supported ? ["system.playSound"] : [],
  };
}

function input(trigger, kind = "text") {
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

async function fixture({
  platform = "macos", supported = true, settings = {},
  settingsError, logError, playSound,
} = {}) {
  const context = launch(platform, supported);
  const registry = await plugin.setup(context);
  const calls = [];
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
  const ctx = {
    launch: context,
    capabilities: { has: (method) => context.capabilities.includes(method) },
    settings: { get: () => call("settings.get", {}) },
    system: { playSound: (params) => call("system.playSound", params) },
    log: { write: (params) => call("log.write", params) },
  };
  return {
    registry, calls,
    detect: (trigger = "copy", kind = "text") => registry.detectors["copy-sound"](input(trigger, kind), ctx),
    sounds: () => calls.filter(({ method }) => method === "system.playSound").map(({ params }) => params),
    warnings: () => calls.filter(({ method }) => method === "log.write").map(({ params }) => params),
  };
}

function hostError(name) {
  return Object.assign(new Error("private error details"), { name });
}

test("the built runtime registers the declared detector with no UI, actions or writes", async () => {
  const { registry } = await fixture();
  assert.deepEqual(Object.keys(registry.detectors), manifest.detectors.map(({ id }) => id));
  assert.deepEqual(manifest.detectors[0].inputKinds, ["text", "image"]);
  assert.equal(manifest.actions, undefined);
  assert.equal(manifest.renderers, undefined);
  assert.equal(manifest.writes, undefined);
});

for (const trigger of ["copy", "recopy"]) {
  for (const kind of ["text", "image"]) {
    test(kind + " " + trigger + " requests the click at 25 percent", async () => {
      const f = await fixture();
      await f.detect(trigger, kind);
      assert.deepEqual(f.calls, [
        { method: "settings.get", params: {} },
        { method: "system.playSound", params: { path: defaultPath, volume: 25 } },
      ]);
    });
  }
}

for (const platform of ["macos", "windows"]) {
  for (const trigger of ["edit", "manual"]) {
    test(platform + " " + trigger + " stays silent", async () => {
      const f = await fixture({ platform });
      await f.detect(trigger);
      assert.deepEqual(f.calls, []);
    });
  }
  test(platform + " without the sound capability is skipped", async () => {
    const f = await fixture({ platform, supported: false });
    await f.detect();
    assert.deepEqual(f.calls, []);
  });
}

test("a sound-capable Windows Host is not excluded by a platform whitelist", async () => {
  const f = await fixture({ platform: "windows" });
  await f.detect();
  assert.deepEqual(f.sounds(), [{ path: defaultPath, volume: 25 }]);
});

test("the detector awaits the Host request before returning", async () => {
  let finish;
  let started;
  let completed = false;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const f = await fixture({
    playSound: () => new Promise((resolve) => { finish = resolve; started(); }),
  });
  const pending = f.detect().then(() => { completed = true; });
  await requestStarted;
  assert.equal(completed, false);
  finish({});
  await pending;
  assert.equal(completed, true);
});

const pathCases = [
  { value: "package/assets/copy 'click';.wav", expected: "package/assets/copy 'click';.wav" },
  { value: "package/assets/custom.mp3", expected: "package/assets/custom.mp3" },
  { value: "package/assets/custom.aiff", expected: "package/assets/custom.aiff" },
  { value: defaultPath, expected: defaultPath },
  ...[
    "/Users/example/copy.wav", "~/Sounds/copy.aiff", "assets/copy.wav",
    "file:///Users/example/copy.wav", "https://example.com/copy.wav",
    "data/copy.wav", "cache/copy.wav", "package/../copy.wav",
    "package/assets/../copy.wav", "package//copy.wav", "package/./copy.wav",
    "package/assets/copy\\click.wav", "package/assets/copy\0.wav",
    "package/assets/copy\n.wav", "package/", "", 42, null,
    "package/" + "声".repeat(400) + ".wav",
  ].map((value) => ({ value, expected: defaultPath })),
];

for (const { value, expected } of pathCases) {
  test("resolves sound path safely: " + JSON.stringify(value).slice(0, 80), async () => {
    const f = await fixture({ settings: { soundPath: value } });
    await f.detect();
    assert.deepEqual(f.sounds(), [{ path: expected, volume: 25 }]);
    assert.deepEqual(f.warnings(), []);
  });
}

for (const [volume, expected] of [[0.25, 25], [0.5, 50], [0.6, 60], [1, 100], [0.126, 13]]) {
  test("normalizes legacy gain " + volume + " to " + expected + " percent", async () => {
    const f = await fixture({ settings: { volume } });
    await f.detect();
    assert.deepEqual(f.sounds(), [{ path: defaultPath, volume: expected }]);
  });
}

for (const volume of ["0.5", null, -1, 2, NaN, Infinity]) {
  test("invalid volume uses 25 percent: " + String(volume), async () => {
    const f = await fixture({ settings: { volume } });
    await f.detect();
    assert.deepEqual(f.sounds(), [{ path: defaultPath, volume: 25 }]);
  });
}

for (const volume of [0, 0.001]) {
  test("volume rounded to zero mutes without occupying a Host slot: " + volume, async () => {
    const f = await fixture({ settings: { volume } });
    await f.detect();
    assert.deepEqual(f.calls, [{ method: "settings.get", params: {} }]);
  });
}

for (const soundPath of [defaultPath, "package/assets/custom.mp3"]) {
  test("busy playback skips without retry or fallback: " + soundPath, async () => {
    const f = await fixture({
      settings: { soundPath },
      playSound: () => { throw hostError("PluginLimitExceeded"); },
    });
    await f.detect();
    assert.deepEqual(f.sounds(), [{ path: soundPath, volume: 25 }]);
    assert.deepEqual(f.warnings(), []);
  });
}

test("a custom resource failure falls back to WAV at the configured volume", async () => {
  const soundPath = "package/assets/private-custom.aiff";
  const f = await fixture({
    settings: { soundPath, volume: 0.4 },
    playSound: ({ path: requested }) => {
      if (requested === soundPath) throw hostError("PluginResourceRejected");
      return {};
    },
  });
  await f.detect();
  assert.deepEqual(f.sounds(), [
    { path: soundPath, volume: 40 }, { path: defaultPath, volume: 40 },
  ]);
  assert.equal(f.warnings().length, 1);
  assert.match(f.warnings()[0].message, /bundled click/);
  assert.ok(!f.warnings()[0].message.includes(soundPath));
});

test("a busy fallback skips without warning or further retries", async () => {
  const soundPath = "package/assets/custom.mp3";
  const f = await fixture({
    settings: { soundPath },
    playSound: ({ path: requested }) => {
      throw hostError(requested === soundPath ? "PluginResourceRejected" : "PluginLimitExceeded");
    },
  });
  await f.detect();
  assert.equal(f.sounds().length, 2);
  assert.deepEqual(f.warnings(), []);
});

for (const errorName of ["PluginResourceRejected", "PluginInvalidRequest"]) {
  test("a Host that rejects the resource or volume is logged safely: " + errorName, async () => {
    const f = await fixture({ playSound: () => { throw hostError(errorName); } });
    await f.detect("copy");
    await f.detect("recopy");
    assert.equal(f.sounds().length, 2);
    assert.equal(f.warnings().length, 2);
    for (const warning of f.warnings()) {
      assert.equal(warning.level, "warn");
      assert.match(warning.message, /Host support/);
      assert.ok(!warning.message.includes("private"));
    }
  });
}

test("failure of both sounds logs one warning without rejecting", async () => {
  const f = await fixture({
    settings: { soundPath: "package/assets/private.wav" },
    playSound: () => { throw hostError("PluginResourceRejected"); },
  });
  await f.detect();
  assert.equal(f.sounds().length, 2);
  assert.equal(f.warnings().length, 1);
  assert.ok(!f.warnings()[0].message.includes("private"));
});

test("settings failures use the default path and gain without exposing error details", async () => {
  const f = await fixture({ settingsError: new Error("private settings error") });
  await f.detect();
  assert.deepEqual(f.sounds(), [{ path: defaultPath, volume: 25 }]);
  assert.equal(f.warnings().length, 1);
  assert.match(f.warnings()[0].message, /could not read its settings/);
  assert.ok(!f.warnings()[0].message.includes("private"));
});

test("path and volume settings are read on every copy", async () => {
  const settings = { soundPath: "package/assets/first.wav", volume: 0.2 };
  const f = await fixture({ settings });
  await f.detect();
  settings.soundPath = "package/assets/second.mp3";
  settings.volume = 0.7;
  await f.detect("recopy");
  settings.volume = 0;
  await f.detect();
  assert.deepEqual(f.sounds(), [
    { path: "package/assets/first.wav", volume: 20 },
    { path: "package/assets/second.mp3", volume: 70 },
  ]);
});

test("logging failures do not reject the detector", async () => {
  const f = await fixture({
    settingsError: new Error("Settings unavailable"),
    logError: new Error("Log unavailable"),
    playSound: () => { throw new Error("Audio output unavailable"); },
  });
  await f.detect();
  assert.deepEqual(f.sounds(), [{ path: defaultPath, volume: 25 }]);
  assert.equal(f.warnings().length, 2);
});

test("the bundled click is PCM16 WAV within installed SDK sound limits", async () => {
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
    offset = start + size + size % 2;
    chunks++;
  }
  assert.ok(chunks <= limits.maximumChunks);
  assert.ok(format && format.length >= 16);
  assert.equal(format.readUInt16LE(0), 1);
  const channels = format.readUInt16LE(2);
  const sampleRate = format.readUInt32LE(4);
  const blockAlign = format.readUInt16LE(12);
  assert.ok(channels === 1 || channels === 2);
  assert.ok(sampleRate >= limits.minimumSampleRate && sampleRate <= limits.maximumSampleRate);
  assert.equal(format.readUInt16LE(14), 16);
  assert.equal(blockAlign, channels * 2);
  assert.equal(format.readUInt32LE(8), sampleRate * blockAlign);
  assert.ok(dataBytes > 0 && dataBytes % blockAlign === 0);
  assert.ok(dataBytes / blockAlign / sampleRate * 1000 <= limits.maximumDurationMs);
});
