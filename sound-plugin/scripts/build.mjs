import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
await access(new URL("../assets/click.aiff", import.meta.url));
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/plugin.ts"],
  outfile: "dist/plugin.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  logLevel: "info",
});
