import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const rawVersion = (process.env.BROWSERAIL_RELEASE_VERSION || process.env.RELEASE_VERSION || "").trim();
const isRelease = Boolean(rawVersion && rawVersion !== "0.1.0");
const releaseVersion = isRelease ? rawVersion.replace(/^v/, "") : "0.1.0";
const releaseTag = isRelease ? (process.env.BROWSERAIL_RELEASE_TAG || `v${releaseVersion}`) : "";

const define = {
  __BROWSERAIL_IS_RELEASE__: JSON.stringify(isRelease),
  __BROWSERAIL_RELEASE_TAG__: JSON.stringify(releaseTag),
  __BROWSERAIL_RELEASE_VERSION__: JSON.stringify(releaseVersion),
};

await build({
  configFile: false,
  root,
  define,
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
  define,
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

const manifestRaw = await readFile(resolve(root, `manifest.${target}.json`), "utf8");
const manifestJson = JSON.parse(manifestRaw);
if (isRelease) {
  manifestJson.version = releaseVersion;
}
await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifestJson, null, 2), "utf8");

await cp(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
