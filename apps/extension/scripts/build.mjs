import { cp, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
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
      entry: resolve(root, "src/content/bar/index.ts"),
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
      entry: resolve(root, "src/content/bridge/index.ts"),
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
      entry: resolve(root, "src/content/bridge/client.ts"),
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
      entry: resolve(root, "src/background/rewrite-worker.ts"),
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
await cp(resolve(root, "src/background/offscreen.html"), resolve(outDir, "offscreen.html"));

const lucide = resolve(root, "node_modules/lucide-static");
const lucideOut = resolve(outDir, "icons/lucide");
const iconNodes = JSON.parse(await readFile(resolve(lucide, "icon-nodes.json"), "utf8"));
const iconFiles = (await readdir(resolve(lucide, "icons"))).filter(name => name.endsWith(".svg")).sort();
const iconBodies = await Promise.all(iconFiles.map(async file => {
  const svg = await readFile(resolve(lucide, "icons", file), "utf8");
  const body = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
  if (!body) throw new Error(`Invalid Lucide SVG: ${file}`);
  return [file.slice(0, -4), body];
}));
// The package's node data omits aliases; match their geometry to canonical icons.
const canonicalNames = new Map(iconBodies.filter(([name]) => Object.hasOwn(iconNodes, name)).map(([name, body]) => [body, name]));
const aliases = {};
for (const [name, body] of iconBodies) {
  if (Object.hasOwn(iconNodes, name)) continue;
  const canonical = canonicalNames.get(body);
  if (!canonical) throw new Error(`Unresolved Lucide alias: ${name}`);
  aliases[name] = canonical;
}
await mkdir(lucideOut, { recursive: true });
await writeFile(resolve(lucideOut, "icons.json"), JSON.stringify({ icons: iconNodes, aliases }));
await cp(resolve(lucide, "LICENSE"), resolve(lucideOut, "LICENSE"));
// Search tags ship separately so the background only loads icon geometry.
await writeFile(resolve(lucideOut, "tags.json"), JSON.stringify(JSON.parse(await readFile(resolve(lucide, "tags.json"), "utf8"))));

// Only the fill weight ships; Lucide already covers outline icons.
const phosphor = resolve(root, "node_modules/@phosphor-icons/core");
const phosphorOut = resolve(outDir, "icons/phosphor");
const phosphorFiles = (await readdir(resolve(phosphor, "assets/fill"))).filter(name => name.endsWith("-fill.svg")).sort();
const phosphorIcons = Object.fromEntries(await Promise.all(phosphorFiles.map(async file => {
  const svg = await readFile(resolve(phosphor, "assets/fill", file), "utf8");
  const body = svg.match(/<svg\b[^>]*viewBox="0 0 256 256"[^>]*>([\s\S]*?)<\/svg>/)?.[1].trim();
  if (!body) throw new Error(`Invalid Phosphor SVG: ${file}`);
  return [file.slice(0, -"-fill.svg".length), body];
})));
await mkdir(phosphorOut, { recursive: true });
await writeFile(resolve(phosphorOut, "icons.json"), JSON.stringify({ icons: phosphorIcons }));
await cp(resolve(phosphor, "LICENSE"), resolve(phosphorOut, "LICENSE"));
const { icons: phosphorMeta } = await import("@phosphor-icons/core");
// Drop release markers such as "*new*".
const phosphorTags = Object.fromEntries(phosphorMeta
  .filter(icon => Object.hasOwn(phosphorIcons, icon.name))
  .map(icon => [icon.name, icon.tags.filter(tag => !tag.startsWith("*"))]));
await writeFile(resolve(phosphorOut, "tags.json"), JSON.stringify(phosphorTags));
