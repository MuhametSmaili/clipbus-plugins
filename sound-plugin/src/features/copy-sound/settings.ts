import { PLUGIN_SOUND_LIMITS } from "@clipbus/plugin-sdk";

export const DEFAULT_SOUND_PATH = "package/assets/click.wav";

export interface SoundSettings {
  soundPath?: unknown;
  volume?: unknown;
}

export function resolveSoundSettings(settings: SoundSettings) {
  const configuredPath = settings.soundPath;
  const isPackagePath =
    typeof configuredPath === "string" &&
    configuredPath.startsWith("package/") &&
    Buffer.byteLength(configuredPath, "utf8") <= PLUGIN_SOUND_LIMITS.maximumPathBytes &&
    !/[\\\u0000-\u001f\u007f]/u.test(configuredPath) &&
    configuredPath.split("/").slice(1).every((part) =>
      part !== "" && part !== "." && part !== "..");

  const volume =
    typeof settings.volume === "number" &&
    Number.isFinite(settings.volume) &&
    settings.volume >= 0 &&
    settings.volume <= 1
      ? settings.volume
      : 0.25;

  return {
    soundPath: isPackagePath ? configuredPath : DEFAULT_SOUND_PATH,
    volume: Math.round(volume * PLUGIN_SOUND_LIMITS.fullVolume),
  };
}
