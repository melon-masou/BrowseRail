import browser from "webextension-polyfill";
import type { IconCatalog } from "./lucide";

interface PhosphorData {
  icons: Record<string, string>;
}

let catalog: Promise<IconCatalog> | undefined;

export function loadPhosphorCatalog(): Promise<IconCatalog> {
  return catalog ??= fetch(browser.runtime.getURL("icons/phosphor/icons.json")).then(async response => {
    if (!response.ok) throw new Error("Unable to load Phosphor icons");
    const data = await response.json() as PhosphorData;
    const urls = new Map<string, string>();
    return {
      names: Object.keys(data.icons).sort(),
      iconUrl(name) {
        if (!Object.hasOwn(data.icons, name)) throw new Error(`Unknown Phosphor icon: ${name}`);
        const existing = urls.get(name);
        if (existing) return existing;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor">${data.icons[name]}</svg>`;
        const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        urls.set(name, url);
        return url;
      },
    };
  });
}
