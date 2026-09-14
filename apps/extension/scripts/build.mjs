import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const target = process.argv[2];
if (target !== "chrome" && target !== "firefox") {
  throw new Error("Expected a chrome or firefox build target");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "..", "..", "build", "extension", target);

await rm(outDir, { force: true, recursive: true });
await mkdir(outDir, { recursive: true });

await build({
  configFile: false,
  root,
  build: {
    emptyOutDir: false,
    outDir,
    rollupOptions: {
      input: resolve(root, "options.html"),
    },
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/background/index.ts"),
      fileName: () => "background.js",
      formats: ["iife"],
      name: "BrowseRailBackground",
    },
    outDir,
  },
});

await copyFile(resolve(root, `manifest.${target}.json`), resolve(outDir, "manifest.json"));
