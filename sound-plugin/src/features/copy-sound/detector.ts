import { isHostError, PLUGIN_ERROR_NAMES } from "@clipbus/plugin-sdk";
import type {
  PluginDetectInput,
  PluginRuntimeCtx,
} from "@clipbus/plugin-sdk/runtime";
import { DEFAULT_SOUND_PATH, resolveSoundSettings, type SoundSettings } from "./settings.ts";

function logWarning(ctx: PluginRuntimeCtx, message: string): Promise<void> {
  return ctx.log.write({ level: "warn", message }).catch(() => undefined);
}

export async function detectCopySound(
  input: PluginDetectInput,
  ctx: PluginRuntimeCtx,
): Promise<void> {
  if (input.trigger !== "copy" && input.trigger !== "recopy") return;
  if (!ctx.capabilities.has("system.playSound")) return;

  let settings: SoundSettings = {};
  try {
    const { values } = await ctx.settings.get<SoundSettings>();
    settings = values;
  } catch {
    await logWarning(
      ctx,
      "Copy Sound could not read its settings. Using the bundled click.",
    );
  }

  const { soundPath, muted } = resolveSoundSettings(settings);
  if (muted) return;

  try {
    try {
      await ctx.system.playSound({ path: soundPath });
    } catch (error) {
      if (isHostError(error, PLUGIN_ERROR_NAMES.limitExceeded)) return;
      if (soundPath === DEFAULT_SOUND_PATH) throw error;
      await ctx.system.playSound({ path: DEFAULT_SOUND_PATH });
      await logWarning(
        ctx,
        "Copy Sound could not play the custom sound. Using the bundled click.",
      );
    }
  } catch (error) {
    if (isHostError(error, PLUGIN_ERROR_NAMES.limitExceeded)) return;
    await logWarning(
      ctx,
      "Copy Sound could not start sound playback. Check the audio output and bundled assets/click.wav.",
    );
  }
}
