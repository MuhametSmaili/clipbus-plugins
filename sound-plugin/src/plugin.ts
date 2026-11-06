import { definePlugin } from "@clipbus/plugin-sdk/runtime";
import { detectCopySound } from "./features/copy-sound/detector.ts";

export default definePlugin({
  detectors: {
    "copy-sound": detectCopySound,
  },
});
