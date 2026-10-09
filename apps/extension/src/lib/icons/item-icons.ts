import browser from "webextension-polyfill";
import type { ItemIcon, LayoutEntry } from "@browserail/protocol";
import { loadLucideCatalog, type IconCatalog } from "./lucide";
import { loadPhosphorCatalog } from "./phosphor";

export type IconFamily = Extract<ItemIcon, { name: string }>["type"];

export function loadIconCatalog(family: IconFamily): Promise<IconCatalog> {
  return family === "phosphor" ? loadPhosphorCatalog() : loadLucideCatalog();
}

const tags = new Map<IconFamily, Promise<Record<string, readonly string[]>>>();

export function loadIconTags(family: IconFamily): Promise<Record<string, readonly string[]>> {
  let loaded = tags.get(family);
  if (!loaded) {
    loaded = fetch(browser.runtime.getURL(`icons/${family}/tags.json`)).then(async response => {
      if (!response.ok) throw new Error(`Unable to load ${family} icon tags`);
      return await response.json() as Record<string, readonly string[]>;
    });
    tags.set(family, loaded);
  }
  return loaded;
}

export async function loadIconUrl(family: IconFamily, name: string): Promise<string> {
  return (await loadIconCatalog(family)).iconUrl(name);
}

export async function resolveItemIcons(items: LayoutEntry[]): Promise<LayoutEntry[]> {
  return Promise.all(items.map(async item => item.icon?.type === "lucide" || item.icon?.type === "phosphor"
    ? { ...item, iconMask: `url("${await loadIconUrl(item.icon.type, item.icon.name)}")` }
    : item));
}
