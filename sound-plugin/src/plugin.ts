import { definePlugin } from "@clipbus/plugin-sdk/runtime";
import { createCopySoundDetector } from "./features/copy-sound/detector.ts";

export default definePlugin({
  setup(context) {
    return {
      detectors: {
        "copy-sound": createCopySoundDetector(context.host.platform),
      },
    };
  },
});
