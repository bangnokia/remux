import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const expoPackageJson = require.resolve("expo/package.json");
const expoCli = join(dirname(expoPackageJson), "bin", "cli");
const args = process.argv.slice(2);

const child = spawn(process.execPath, [expoCli, "start", ...args], {
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"]
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
