import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "dist");
const outputFile = resolve(outputDir, "telemux-server.mjs");

await mkdir(outputDir, { recursive: true });

await build({
  absWorkingDir: root,
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire } from 'node:module';",
      "const require = createRequire(import.meta.url);"
    ].join("\n")
  },
  bundle: true,
  entryPoints: ["apps/server/src/index.ts"],
  format: "esm",
  logLevel: "info",
  outfile: outputFile,
  platform: "node",
  target: "node24"
});

await chmod(outputFile, 0o755);
console.log(`Built ${outputFile}`);
