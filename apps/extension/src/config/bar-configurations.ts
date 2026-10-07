import browser from "webextension-polyfill";
import { defaultBarSettings, defaultNativeBarSettings, normalizeBarConfigurations, normalizeMenuSpacing, isBarSettings, isNativeBarSettings, isMenuSpacing, type BarConfigurations, type BarConfiguration, type NativeBarConfiguration, type BarSettings, type NativeBarSettings, type MenuPlacement, type MenuSpacing } from "@browserail/protocol";
import { defaultMenuPlacement, normalizeBrowserPlacement, type BrowserMenuPlacement, type DisplayMode } from "./index";
import { loadConfig, loadBookmarkRootPrefix } from "./index";
import { menuEntryIdentity } from "../bookmarks/identity";
import { storeMenuSpacing } from "../bookmarks/spacing";

export const BAR_CONFIGURATIONS_STORAGE_KEY = "bar_configurations";
export async function loadBarConfigurations(): Promise<BarConfigurations> {
  const stored = await browser.storage.local.get(BAR_CONFIGURATIONS_STORAGE_KEY);
  return normalizeBarConfigurations(stored[BAR_CONFIGURATIONS_STORAGE_KEY]);
}
export function resolveBarConfiguration(configs: BarConfigurations, mode: "native", uid: string, index?: number): NativeBarConfiguration;
export function resolveBarConfiguration(configs: BarConfigurations, mode: "browser", uid: string, index?: number): BarConfiguration;
export function resolveBarConfiguration(configs: BarConfigurations, mode: DisplayMode, uid: string, index = 0): BarConfiguration | NativeBarConfiguration {
  return configs[mode][uid] ?? { ...(mode === "native" ? defaultNativeBarSettings() : defaultBarSettings()), ...normalizeMenuSpacing(undefined), placement: defaultMenuPlacement(index) };
}
export async function saveBarLayout(uid: string, mode: DisplayMode, placement: MenuPlacement, spacing: MenuSpacing, settings: BarSettings | NativeBarSettings): Promise<void> {
  if (!isMenuSpacing(spacing)) throw new Error("Invalid bar spacing");
  if (!(mode === "native" ? isNativeBarSettings(settings) : isBarSettings(settings))) throw new Error("Invalid bar settings");
  const config = await loadConfig();
  const items = config.panel.menus.find(menu => menu.uid === uid)?.items ?? [];
  const hasSubitems = Object.keys(spacing.extraGaps).some(key => {
    if (items.some(item => item.uid === key)) return false;
    const { itemUid, bookmarkId } = menuEntryIdentity(key);
    return bookmarkId !== undefined && items.some(item => item.uid === itemUid && item.type === "flattenFolder");
  });
  const [tree, rootPrefix] = hasSubitems ? await Promise.all([browser.bookmarks.getTree(), loadBookmarkRootPrefix()]) : [[], []];
  const storedSpacing = storeMenuSpacing(spacing, items, tree, rootPrefix);
  const current = await loadBarConfigurations();
  const updated = normalizeBarConfigurations({ [mode]: { [uid]: { ...settings, ...storedSpacing, placement } } });
  if (!updated[mode][uid]) throw new Error("Invalid bar layout");
  if (mode === "native") current.native[uid] = updated.native[uid]!;
  else current.browser[uid] = updated.browser[uid]!;
  const clean = normalizeBarConfigurations(current);
  await browser.storage.local.set({ [BAR_CONFIGURATIONS_STORAGE_KEY]: clean });
}
export async function importBarConfigurations(imported: BarConfigurations, menuUids: string[]): Promise<void> {
  const current = await loadBarConfigurations();
  for (const mode of ["native", "browser"] as const) {
    for (const uid of menuUids) {
      delete current[mode][uid];
    }
  }
  for (const uid of menuUids) {
    if (imported.native[uid]) current.native[uid] = imported.native[uid]!;
    if (imported.browser[uid]) current.browser[uid] = imported.browser[uid]!;
  }
  await browser.storage.local.set({ [BAR_CONFIGURATIONS_STORAGE_KEY]: current });
}
export async function loadMenuPlacements(): Promise<Record<string, MenuPlacement>> {
  return Object.fromEntries(Object.entries((await loadBarConfigurations()).native).map(([uid, config]) => [uid, config.placement]));
}
export async function loadBrowserPlacements(): Promise<Record<string, BrowserMenuPlacement>> {
  return Object.fromEntries(Object.entries((await loadBarConfigurations()).browser).flatMap(([uid, config]) => {
    const placement = normalizeBrowserPlacement({ ...config.placement.boundPosition, itemWidth: config.placement.itemWidth, itemHeight: config.placement.itemHeight });
    return placement ? [[uid, placement]] : [];
  }));
}
export async function removeBrowserPlacement(uid: string): Promise<void> { await resetBarPlacement(uid, "browser"); }
export async function removeMenuPlacements(uid: string): Promise<void> { await resetBarPlacement(uid, "native"); }
async function resetBarPlacement(uid: string, mode: DisplayMode): Promise<void> {
  const current = await loadBarConfigurations();
  const config = current[mode][uid];
  if (config) {
    config.placement.boundPosition = defaultMenuPlacement().boundPosition;
    delete config.placement.freePosition;
  }
  await browser.storage.local.set({ [BAR_CONFIGURATIONS_STORAGE_KEY]: current });
}
