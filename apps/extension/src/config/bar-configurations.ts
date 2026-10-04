import browser from "webextension-polyfill";
import { defaultBarSettings, defaultNativeBarSettings, normalizeBarConfigurations, normalizeMenuSpacing, isBarSettings, isNativeBarSettings, isMenuSpacing, type BarConfigurations, type BarConfiguration, type NativeBarConfiguration, type BarSettings, type NativeBarSettings, type MenuPlacement, type MenuSpacing } from "@browserail/protocol";
import { defaultMenuPlacement, normalizeBrowserPlacement, type BrowserMenuPlacement, type DisplayMode } from "./index";
import { applyBarSettingsGroups, isBarSettingsGroups, type BarSettingsGroup } from "@browserail/protocol";
import { loadConfig } from "./index";

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
export async function saveBarLayout(uid: string, mode: DisplayMode, placement: MenuPlacement, spacing: MenuSpacing, settings: BarSettings | NativeBarSettings, applyToAll: BarSettingsGroup[] = []): Promise<void> {
  if (!isMenuSpacing(spacing)) throw new Error("Invalid bar spacing");
  if (!(mode === "native" ? isNativeBarSettings(settings) : isBarSettings(settings))) throw new Error("Invalid bar settings");
  if (!isBarSettingsGroups(applyToAll)) throw new Error("Invalid bar settings groups");
  const current = await loadBarConfigurations();
  const updated = normalizeBarConfigurations({ [mode]: { [uid]: { ...settings, ...normalizeMenuSpacing(spacing), placement } } });
  if (!updated[mode][uid]) throw new Error("Invalid bar layout");
  if (mode === "native") current.native[uid] = updated.native[uid]!;
  else current.browser[uid] = updated.browser[uid]!;
  if (applyToAll.length) {
    const config = await loadConfig();
    for (const [index, menu] of config.panel.menus.entries()) {
      if (menu.uid === uid) continue;
      if (mode === "native") {
        const target = resolveBarConfiguration(current, "native", menu.uid, index);
        current.native[menu.uid] = applyBarSettingsGroups(target, settings, applyToAll);
      } else {
        const target = resolveBarConfiguration(current, "browser", menu.uid, index);
        current.browser[menu.uid] = applyBarSettingsGroups(target, settings, applyToAll);
      }
    }
  }
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
