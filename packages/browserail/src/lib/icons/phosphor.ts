import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import type { IconCatalog } from "./lucide";

interface PhosphorData {
  icons: Record<string, string>;
}

let catalog: Promise<IconCatalog> | undefined;

export function loadPhosphorCatalog(): Promise<IconCatalog> {
  return catalog ??= getRuntimeAdapter().resourceJson("icons/phosphor/icons.json").then(value => {
    const data = value as PhosphorData;
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
