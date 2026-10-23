import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";
import { loadIconAssets } from "@browserail/browserail/build-icons";

const target = process.argv[2] === "firefox" ? "firefox" : "chrome";

const root = dirname(fileURLToPath(import.meta.url));
// Other workspace packages are reached through their package exports, never relative paths.
const packageEntry = (specifier) => fileURLToPath(import.meta.resolve(specifier));
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

const settingsTemplate = await readFile(packageEntry("@browserail/browserail/settings-template"), "utf8");

await build({
  configFile: false,
  root: resolve(root, "src/pages"),
  define,
  plugins: [{
    name: "browserail-settings",
    transformIndexHtml: {
      order: "pre",
      handler(html, context) {
        if (resolve(context.filename) !== resolve(root, "src/pages/options.html")) return;
        return settingsTemplate.replace("</body>", `${html}</body>`);
      },
    },
  }],
  build: {
    emptyOutDir: false,
    outDir,
    rollupOptions: {
      input: {
        options: resolve(root, "src/pages/options.html"),
        temporaryConfirm: resolve(root, "src/pages/temporary-confirm.html"),
      },
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

await build({
  configFile: false,
  define,
  build: {
    emptyOutDir: false,
    lib: {
      entry: packageEntry("@browserail/content/bar"),
      fileName: () => "content.js",
      formats: ["iife"],
      name: "BrowseRailContent",
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
      entry: packageEntry("@browserail/content/bridge"),
      fileName: () => "external-updates.js",
      formats: ["iife"],
      name: "BrowseRailExternalUpdates",
    },
    outDir,
  },
});

await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: packageEntry("@browserail/protocol/userscript-client"),
      fileName: () => "userscript-client.js",
      formats: ["iife"],
      name: "BrowseRailExternalClient",
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
      entry: resolve(root, "src/background/offscreen.ts"),
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
      entry: packageEntry("@browserail/browserail/lib/rewrite/worker"),
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

await writeFile(resolve(outDir, "offscreen.html"), await readFile(resolve(root, "src/background/offscreen.html")));
for (const [path, contents] of Object.entries(await loadIconAssets())) {
  await mkdir(dirname(resolve(outDir, path)), { recursive: true });
  await writeFile(resolve(outDir, path), contents);
}
