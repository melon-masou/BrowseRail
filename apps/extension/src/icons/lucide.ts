import browser from "webextension-polyfill";

type LucideNode = [tag: string, attributes: Record<string, string>];

interface LucideData {
  icons: Record<string, LucideNode[]>;
  aliases: Record<string, string>;
}

export interface IconCatalog {
  names: readonly string[];
  iconUrl(name: string): string;
}

let catalog: Promise<IconCatalog> | undefined;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function loadLucideCatalog(): Promise<IconCatalog> {
  return catalog ??= fetch(browser.runtime.getURL("icons/lucide/icons.json")).then(async response => {
    if (!response.ok) throw new Error("Unable to load Lucide icons");
    const data = await response.json() as LucideData;
    const urls = new Map<string, string>();
    return {
      names: [...Object.keys(data.icons), ...Object.keys(data.aliases)].sort(),
      iconUrl(name) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Invalid Lucide icon name");
        const canonical = Object.hasOwn(data.aliases, name) ? data.aliases[name]! : name;
        if (!Object.hasOwn(data.icons, canonical)) throw new Error(`Unknown Lucide icon: ${name}`);
        const existing = urls.get(canonical);
        if (existing) return existing;
        const body = data.icons[canonical]!.map(([tag, attributes]) =>
          `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(" ")}/>`).join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
        const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        urls.set(canonical, url);
        return url;
      },
    };
  });
}
