import { execFile } from "node:child_process";
import type {
  PluginDetectInput,
  PluginPlatform,
  PluginRuntimeCtx,
} from "@clipbus/plugin-sdk/runtime";
import { resolveSoundSettings, type SoundSettings } from "./settings.ts";

function playSound(soundPath: string, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/afplay",
      ["-v", String(volume), soundPath],
      { timeout: 1000, maxBuffer: 16 * 1024 },
      (error) => {
        if (error)
          reject(new Error("Sound playback failed.", { cause: error }));
        else resolve();
      },
    );
  });
}

function logWarning(ctx: PluginRuntimeCtx, message: string): Promise<void> {
  return ctx.log.write({ level: "warn", message }).catch(() => undefined);
}

export function createCopySoundDetector(
  defaultSoundPath: string,
  platform: PluginPlatform,
) {
  return async (
    input: PluginDetectInput,
    ctx: PluginRuntimeCtx,
  ): Promise<void> => {
    if (platform !== "macos") return;
    if (input.trigger !== "copy" && input.trigger !== "recopy") return;

    let settings: SoundSettings = {};
    try {
      const { values } = await ctx.settings.get<SoundSettings>();
      settings = values;
    } catch {
      await logWarning(
        ctx,
        "Copy Sound could not read its settings. Using the default sound and volume.",
      );
    }

    const { soundPath, volume } = resolveSoundSettings(
      settings,
      defaultSoundPath,
    );
    if (volume === 0) return;

    try {
      try {
        await playSound(soundPath, volume);
      } catch (error) {
        if (soundPath === defaultSoundPath) throw error;
        await playSound(defaultSoundPath, volume);
        await logWarning(
          ctx,
          "Copy Sound could not play the custom sound. Using the bundled click.",
        );
      }
    } catch {
      await logWarning(
        ctx,
        "Copy Sound could not play its sound. Check the audio output and bundled assets/click.aiff.",
      );
    }
  };
}
