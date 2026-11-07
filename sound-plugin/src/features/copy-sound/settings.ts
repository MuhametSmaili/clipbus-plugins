import { PLUGIN_SOUND_LIMITS } from "@clipbus/plugin-sdk";

export const DEFAULT_SOUND_PATH = "package/assets/click.wav";

export interface SoundSettings {
  soundPath?: unknown;
  volume?: unknown;
}

export function resolveSoundSettings(settings: SoundSettings) {
  const configuredPath = settings.soundPath;
  let soundPath = DEFAULT_SOUND_PATH;

  if (
    typeof configuredPath === "string" &&
    configuredPath.startsWith("package/") &&
    !/\p{Control}/u.test(configuredPath) &&
    !configuredPath.includes("\\") &&
    Buffer.byteLength(configuredPath, "utf8") <=
      PLUGIN_SOUND_LIMITS.maximumPathBytes &&
    configuredPath
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  ) {
    soundPath = configuredPath;
  }

  const volume =
    typeof settings.volume === "number" &&
    Number.isFinite(settings.volume) &&
    settings.volume >= 0 &&
    settings.volume <= 1
      ? settings.volume
      : 0.25;

  return { soundPath, volume: Math.round(volume * 100) };
}
