import type { DownloadedIconLibrary, IconFamily, IconResources, StorageService } from "@browserail/runtime-adapter";
import type { UserscriptApi } from "@browserail/runtime-adapter/userscript";
import { ICON_USED_STORAGE_KEY } from "@browserail/browserail/lib/config/index";

const CDN = "https://cdn.jsdelivr.net/npm/";
const SOURCES = {
  lucide: { icons: "@iconify-json/lucide@1.2.154/icons.json", tags: "lucide-static@1.52.0/tags.json" },
  phosphor: { icons: "@iconify-json/ph@1.2.2/icons.json", tags: "@phosphor-icons/core@2.1.1/dist/index.mjs" },
} as const;

interface IconData {
  width: number;
  height: number;
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string }>;
}

function readUsed(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([key, svg]) =>
    /^(lucide|phosphor):[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && typeof svg === "string"));
}

function svgUrl(svg: string): string { return `data:image/svg+xml,${encodeURIComponent(svg)}`; }

export async function createUserscriptIcons(api: UserscriptApi, storage: StorageService): Promise<IconResources & { destroy(): void }> {
  let used = readUsed((await storage.local.get(ICON_USED_STORAGE_KEY))[ICON_USED_STORAGE_KEY]);
  const usedUrls = new Map<string, string>();
  const libraries = new Map<IconFamily, DownloadedIconLibrary>();
  const rawIcons = new Map<IconFamily, Map<string, string>>();
  const downloads = new Map<IconFamily, Promise<void>>();
  const requests = new Set<ReturnType<UserscriptApi["xmlHttpRequest"]>>();
  let writing = Promise.resolve();
  let destroyed = false;

  const changed: Parameters<StorageService["onChanged"]["addListener"]>[0] = (changes, area) => {
    if (area === "local" && changes[ICON_USED_STORAGE_KEY]) {
      used = readUsed(changes[ICON_USED_STORAGE_KEY].newValue);
      usedUrls.clear();
    }
  };
  storage.onChanged.addListener(changed);

  async function downloadText(path: string): Promise<string> {
    const request = api.xmlHttpRequest({ url: CDN + path, method: "GET", anonymous: true, timeout: 30000 });
    requests.add(request);
    try {
      const response = await request;
      if (destroyed) throw new Error("Icon download was cancelled");
      if (response.status !== 200) throw new Error(`Icon download failed: HTTP ${response.status}`);
      return response.responseText;
    } finally { requests.delete(request); }
  }

  async function download(family: IconFamily): Promise<void> {
    if (destroyed) throw new Error("Icon resources are closed");
    if (libraries.has(family)) return;
    const pending = downloads.get(family);
    if (pending) return pending;
    const task = (async () => {
      const source = SOURCES[family];
      const [iconText, tagText] = await Promise.all([downloadText(source.icons), downloadText(source.tags)]);
      const data = JSON.parse(iconText) as IconData;
      if (!data.icons || !Number.isFinite(data.width) || !Number.isFinite(data.height)) throw new Error("Invalid icon library");
      const svgs = new Map<string, string>();
      const suffix = family === "phosphor" ? "-fill" : "";
      for (const name of [...Object.keys(data.icons), ...Object.keys(data.aliases ?? {})]) {
        if (suffix && !name.endsWith(suffix)) continue;
        let canonical = name;
        const seen = new Set<string>();
        while (data.aliases && Object.hasOwn(data.aliases, canonical)) {
          if (seen.has(canonical)) throw new Error("Invalid icon alias");
          seen.add(canonical);
          canonical = data.aliases[canonical]!.parent;
        }
        const icon = data.icons[canonical];
        if (!icon || typeof icon.body !== "string") throw new Error(`Invalid icon: ${name}`);
        svgs.set(suffix ? name.slice(0, -suffix.length) : name,
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? data.width} ${icon.height ?? data.height}">${icon.body}</svg>`);
      }
      let tags: Record<string, readonly string[]>;
      if (family === "lucide") tags = JSON.parse(tagText) as Record<string, readonly string[]>;
      else {
        // This pinned package publishes search metadata as static JS; extract its data without executing it.
        tags = Object.fromEntries([...tagText.matchAll(/name: "([a-z0-9-]+)"[\s\S]*?tags:\s*(\[[\s\S]*?\])/g)]
          .map(match => [match[1]!, (JSON.parse(match[2]!) as string[]).filter(tag => !tag.startsWith("*"))]));
        if (!Object.keys(tags).length) throw new Error("Invalid icon search metadata");
      }
      if (destroyed) return;
      const urls = new Map<string, string>();
      rawIcons.set(family, svgs);
      libraries.set(family, {
        names: [...svgs.keys()].sort(), tags,
        iconUrl(name) {
          const svg = svgs.get(name);
          if (!svg) throw new Error(`Unknown ${family} icon: ${name}`);
          let url = urls.get(name);
          if (!url) { url = svgUrl(svg); urls.set(name, url); }
          return url;
        },
      });
    })();
    downloads.set(family, task);
    try { await task; } finally { downloads.delete(family); }
  }

  return {
    library: family => libraries.get(family),
    download,
    async usedUrl(family, name) {
      const key = `${family}:${name}`;
      const svg = used[key];
      if (!svg) return undefined;
      let url = usedUrls.get(key);
      if (!url) { url = svgUrl(svg); usedUrls.set(key, url); }
      return url;
    },
    remember(family, name) {
      const key = `${family}:${name}`;
      const svg = rawIcons.get(family)?.get(name);
      if (!svg) return Promise.reject(new Error(`Icon has not been downloaded: ${key}`));
      const save = writing.then(async () => {
        if (destroyed) return;
        const latest = readUsed((await storage.local.get(ICON_USED_STORAGE_KEY))[ICON_USED_STORAGE_KEY]);
        if (latest[key] === svg) return;
        await storage.local.set({ [ICON_USED_STORAGE_KEY]: { ...latest, [key]: svg } });
      });
      writing = save.catch(() => {});
      return save;
    },
    destroy() {
      destroyed = true;
      storage.onChanged.removeListener(changed);
      for (const request of requests) request.abort?.();
      libraries.clear(); rawIcons.clear(); usedUrls.clear(); used = {};
    },
  };
}
