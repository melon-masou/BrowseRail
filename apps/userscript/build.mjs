import { build } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { loadIconAssets } from "@browserail/browserail/build-icons";

const root = fileURLToPath(new URL(".", import.meta.url));
const rawVersion = (process.env.BROWSERAIL_RELEASE_VERSION || process.env.RELEASE_VERSION || "").trim();
const isRelease = Boolean(rawVersion && rawVersion !== "0.1.0");
const releaseVersion = isRelease ? rawVersion.replace(/^v/, "") : "0.1.0";
const releaseTag = isRelease ? (process.env.BROWSERAIL_RELEASE_TAG || `v${releaseVersion}`) : "";
const releaseDefines = {
  __BROWSERAIL_IS_RELEASE__: JSON.stringify(isRelease), __BROWSERAIL_RELEASE_TAG__: JSON.stringify(releaseTag),
  __BROWSERAIL_RELEASE_VERSION__: JSON.stringify(releaseVersion),
};
const entry = specifier => fileURLToPath(import.meta.resolve(specifier));
const icons = await loadIconAssets();
const resources = { "icons/48.png": `data:image/png;base64,${Buffer.from(icons["icons/48.png"]).toString("base64")}` };
const resourceData = Object.fromEntries(Object.entries(icons).filter(([path]) => path.endsWith(".json"))
  .map(([path, content]) => [path, JSON.parse(content.toString())]));
const [worker] = await build({ configFile: false, logLevel: "silent", build: {
  write: false, lib: { entry: entry("@browserail/browserail/lib/rewrite/worker"), formats: ["iife"], name: "BrowseRailRewrite" },
} });
const workerSource = worker.output.find(file => file.type === "chunk").code;
const [settings] = await build({ configFile: resolve(root, "settings.vite.config.ts"), logLevel: "silent", define: releaseDefines });
const settingsFactory = settings.output.find(file => file.type === "chunk").code;
const grants = ["getValue", "setValue", "deleteValue", "listValues", "addValueChangeListener", "removeValueChangeListener", "openInTab", "registerMenuCommand"];
const metadata = [
  "// ==UserScript==", "// @name BrowseRail", "// @namespace https://github.com/melon-masou/BrowseRail",
  `// @version ${releaseVersion}`, "// @description Configurable bookmark menus on web pages",
  "// @match http://*/*", "// @match https://*/*", "// @run-at document-idle", "// @noframes", "// @sandbox DOM",
  ...grants.map(grant => `// @grant GM.${grant}`), "// ==/UserScript==",
].join("\n");
const [bundle] = await build({
  configFile: false,
  define: { __BROWSERAIL_RESOURCES__: JSON.stringify(resources), __BROWSERAIL_REWRITE_WORKER__: JSON.stringify(workerSource),
    __BROWSERAIL_RESOURCE_DATA__: JSON.stringify(resourceData),
    __BROWSERAIL_SETTINGS__: settingsFactory, ...releaseDefines },
  build: {
    write: false,
    lib: { entry: resolve(root, "src/index.ts"), fileName: () => "browserail.user.js", formats: ["iife"], name: "BrowseRailUserscript" },
  },
});
// Metadata must survive JavaScript comment removal and remain the first bytes of the installed file.
const licenses = ["lucide", "phosphor"].map(family => `/* ${family}\n${icons[`icons/${family}/LICENSE`].toString()}\n*/`).join("\n");
const code = bundle.output.find(file => file.type === "chunk").code;
const outDir = resolve(root, "../../build/userscript");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "browserail.user.js"), `${metadata}\n${code}\n${licenses}\n`);
