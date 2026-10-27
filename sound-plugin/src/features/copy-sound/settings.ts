import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface SoundSettings {
  soundPath?: unknown;
  volume?: unknown;
}

export function resolveSoundSettings(
  settings: SoundSettings,
  defaultSoundPath: string,
) {
  const configuredPath = settings.soundPath;
  let soundPath = defaultSoundPath;

  if (typeof configuredPath === "string" && !configuredPath.includes("\0")) {
    if (configuredPath.startsWith("~/")) {
      soundPath = join(homedir(), configuredPath.slice(2));
    } else if (isAbsolute(configuredPath)) {
      soundPath = configuredPath;
    }
  }

  const volume =
    typeof settings.volume === "number" &&
    Number.isFinite(settings.volume) &&
    settings.volume >= 0 &&
    settings.volume <= 1
      ? settings.volume
      : 0.25;

  return { soundPath, volume };
}
