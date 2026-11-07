import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const npmPath = process.env.CLIPBUS_PLUGIN_NPM_PATH;
if (!npmPath)
  throw new Error(
    "CLIPBUS_PLUGIN_NPM_PATH is required. For a manual build, run npm ci && npm run build.",
  );
await access(npmPath);
const resolvedPath = await realpath(npmPath);
const isJavaScriptCli = /\.(?:c|m)?js$/i.test(resolvedPath);
const command = isJavaScriptCli ? process.execPath : npmPath;
const prefix = isJavaScriptCli ? [npmPath] : [];

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefix, ...args], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`npm ${args.join(" ")} failed (${signal ?? code}).`));
    });
  });
}

await runNpm(["ci", "--include=dev", "--ignore-scripts"]);
await runNpm(["run", "build"]);
