import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import type { ItemIcon, LayoutEntry } from "@browserail/protocol";
import { loadLucideCatalog, type IconCatalog } from "./lucide";
import { loadPhosphorCatalog } from "./phosphor";

export type IconFamily = Extract<ItemIcon, { name: string }>["type"];
export const DEFAULT_ICON_URL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>')}`;

export function loadIconCatalog(family: IconFamily): Promise<IconCatalog> {
  const resources = getRuntimeAdapter().iconResources;
  if (resources) {
    const library = resources.library(family);
    return library ? Promise.resolve(library) : Promise.reject(new Error("Icon library has not been downloaded"));
  }
  return family === "phosphor" ? loadPhosphorCatalog() : loadLucideCatalog();
}

const tags = new Map<IconFamily, Promise<Record<string, readonly string[]>>>();

export function loadIconTags(family: IconFamily): Promise<Record<string, readonly string[]>> {
  const resources = getRuntimeAdapter().iconResources;
  if (resources) return loadIconCatalog(family).then(() => resources.library(family)!.tags);
  let loaded = tags.get(family);
  if (!loaded) {
    loaded = getRuntimeAdapter().resourceJson(`icons/${family}/tags.json`).then(value => value as Record<string, readonly string[]>);
    tags.set(family, loaded);
  }
  return loaded;
}

export async function loadIconUrl(family: IconFamily, name: string): Promise<string | undefined> {
  const resources = getRuntimeAdapter().iconResources;
  if (resources) return resources.usedUrl(family, name);
  return (await loadIconCatalog(family)).iconUrl(name);
}

export async function resolveItemIcons(items: LayoutEntry[]): Promise<LayoutEntry[]> {
  return Promise.all(items.map(async item => {
    if (item.icon?.type !== "lucide" && item.icon?.type !== "phosphor") return item;
    const url = await loadIconUrl(item.icon.type, item.icon.name) ?? DEFAULT_ICON_URL;
    return { ...item, iconMask: `url("${url}")` };
  }));
}
