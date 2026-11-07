import { isHostError, PLUGIN_ERROR_NAMES } from "@clipbus/plugin-sdk";
import type {
  PluginDetectInput,
  PluginPlatform,
  PluginRuntimeCtx,
} from "@clipbus/plugin-sdk/runtime";
import {
  DEFAULT_SOUND_PATH,
  resolveSoundSettings,
  type SoundSettings,
} from "./settings.ts";

function logWarning(ctx: PluginRuntimeCtx, message: string): Promise<void> {
  return ctx.log.write({ level: "warn", message }).catch(() => undefined);
}

export function createCopySoundDetector(platform: PluginPlatform) {
  let rejectedSoundPath: string | undefined;

  return async (
    input: PluginDetectInput,
    ctx: PluginRuntimeCtx,
  ): Promise<void> => {
    if (platform !== "macos") return;
    if (input.trigger !== "copy" && input.trigger !== "recopy") return;
    if (!ctx.capabilities.has("system.playSound")) return;

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

    const { soundPath, volume } = resolveSoundSettings(settings);
    if (volume === 0) return;
    if (soundPath !== rejectedSoundPath) rejectedSoundPath = undefined;
    const playbackPath =
      soundPath === rejectedSoundPath ? DEFAULT_SOUND_PATH : soundPath;

    try {
      await ctx.system.playSound({ path: playbackPath, volume });
    } catch (error) {
      if (isHostError(error, PLUGIN_ERROR_NAMES.limitExceeded)) return;
      if (isHostError(error, PLUGIN_ERROR_NAMES.capabilityUnsupported)) return;
      if (
        playbackPath !== DEFAULT_SOUND_PATH &&
        isHostError(error, PLUGIN_ERROR_NAMES.resourceRejected)
      ) {
        rejectedSoundPath = playbackPath;
        await logWarning(
          ctx,
          "Copy Sound could not play the custom sound. The bundled click will be used on the next copy; reload the plugin to retry the custom sound.",
        );
        return;
      }
      await logWarning(
        ctx,
        "Copy Sound could not play its sound. Check Clipbus sound support, the audio output and bundled assets/click.wav.",
      );
    }
  };
}
