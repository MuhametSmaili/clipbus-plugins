import { join } from "node:path";
import { definePlugin } from "@clipbus/plugin-sdk/runtime";
import { createCopySoundDetector } from "./features/copy-sound/detector.ts";

export default definePlugin({
  setup(context) {
    return {
      detectors: {
        "copy-sound": createCopySoundDetector(
          join(context.dirs.root, "assets", "click.aiff"),
          context.host.platform,
        ),
      },
    };
  },
});
