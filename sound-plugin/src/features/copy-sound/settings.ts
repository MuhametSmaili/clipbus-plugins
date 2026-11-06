import { PLUGIN_SOUND_LIMITS } from "@clipbus/plugin-sdk";

export const DEFAULT_SOUND_PATH = "package/assets/click.wav";

export interface SoundSettings {
  enabled?: unknown;
  soundPath?: unknown;
  // Compatibility with the former afplay settings: only zero still has meaning.
  volume?: unknown;
}

export function resolveSoundSettings(settings: SoundSettings) {
  const configuredPath = settings.soundPath;
  const isPackagePath =
    typeof configuredPath === "string" &&
    configuredPath.startsWith("package/") &&
    Buffer.byteLength(configuredPath, "utf8") <= PLUGIN_SOUND_LIMITS.maximumPathBytes &&
    !/[\\\u0000-\u001f\u007f]/u.test(configuredPath) &&
    configuredPath.split("/").slice(1).every((part) => part !== "" && part !== "." && part !== "..");

  return {
    soundPath: isPackagePath ? configuredPath : DEFAULT_SOUND_PATH,
    muted: settings.enabled === false || settings.volume === 0,
  };
}
