import { cp, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const target = process.argv[2] === "firefox" ? "firefox" : "chrome";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "..", "..", "build", "extension", target);

await rm(outDir, { force: true, recursive: true });
await mkdir(outDir, { recursive: true });

const rawVersion = (process.env.BROWSERAIL_RELEASE_VERSION || process.env.RELEASE_VERSION || "").trim();
const isRelease = Boolean(rawVersion && rawVersion !== "0.1.0");
const releaseVersion = isRelease ? rawVersion.replace(/^v/, "") : "0.1.0";
const releaseTag = isRelease ? (process.env.BROWSERAIL_RELEASE_TAG || `v${releaseVersion}`) : "";

const define = {
  __BROWSERAIL_TARGET__: JSON.stringify(target),
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
      input: {
        options: resolve(root, "src/pages/options/index.html"),
        temporaryConfirm: resolve(root, "src/pages/bookmark-confirm/index.html"),
      },
    },
  },
});

// Keep the extension's page URLs independent of the source directory layout.
await rename(resolve(outDir, "src/pages/options/index.html"), resolve(outDir, "options.html"));
await rename(resolve(outDir, "src/pages/bookmark-confirm/index.html"), resolve(outDir, "temporary-confirm.html"));
for (const directory of ["src/pages/options", "src/pages/bookmark-confirm", "src/pages", "src"]) {
  await rmdir(resolve(outDir, directory));
}

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

await build({
  configFile: false,
  define,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/page-operations/index.ts"),
      fileName: () => "content.js",
      formats: ["iife"],
      name: "BrowseRailContent",
    },
    outDir,
  },
});

// Sandboxed executor + its Chrome offscreen host, built as classic IIFE scripts
// (a sandboxed page's opaque origin does not play well with module scripts).
await build({
  configFile: false,
  define,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/pages/sandbox/index.ts"),
      fileName: () => "sandbox.js",
      formats: ["iife"],
      name: "BrowseRailSandbox",
    },
    outDir,
  },
});

await build({
  configFile: false,
  define,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/pages/offscreen/index.ts"),
      fileName: () => "offscreen.js",
      formats: ["iife"],
      name: "BrowseRailOffscreen",
    },
    outDir,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "src/dynamic/rewrite-worker.ts"),
      fileName: () => "rewrite-worker.js",
      formats: ["iife"],
      name: "BrowseRailRewrite",
    },
    outDir,
  },
});

const manifestRaw = await readFile(resolve(root, `manifest.${target}.json`), "utf8");
const manifestJson = JSON.parse(manifestRaw);
if (isRelease) {
  manifestJson.version = releaseVersion;
}
// Chrome derives an unpacked extension's ID from its load directory unless the
// manifest pins an identity with a public-key "key". Releases must stay the
// same extension no matter where users unzip them, so the public key is
// injected for release builds via EXTENSION_PUBKEY. Dev builds are
// path-scoped on purpose and omit the key entirely.
if (target === "chrome") {
  const extensionKey = (process.env.EXTENSION_PUBKEY || "").trim();
  if (extensionKey) {
    if (!isRelease) {
      console.warn("[build:chrome] EXTENSION_PUBKEY is set on a dev build; ignoring it so the dev build stays path-scoped.");
    } else {
      manifestJson.key = extensionKey;
    }
  } else if (isRelease) {
    console.warn("[build:chrome] EXTENSION_PUBKEY is not set; the release build will get a path-derived ID and will not share an identity across machines.");
  }
}
await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifestJson, null, 2), "utf8");

await cp(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
await cp(resolve(root, "src/pages/sandbox/index.html"), resolve(outDir, "sandbox.html"));
await cp(resolve(root, "src/pages/offscreen/index.html"), resolve(outDir, "offscreen.html"));
