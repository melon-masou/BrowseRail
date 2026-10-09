import { t } from "@browserail/i18n";
import { type BarConfigurations, type BarSettings } from "@browserail/protocol";
import browser from "webextension-polyfill";
import { loadBarConfigurations, loadConfig, loadDisplayMode, resolveBarConfiguration, type DisplayMode } from "../config";

const prefix = (mode: DisplayMode): string => `auto_hide_override:${mode}:`;

function signature(settings: BarSettings): string {
  return JSON.stringify([settings.orientation, settings.autoHide, settings.autoHidePadding, settings.autoHideRange]);
}

export async function autoHideEnabled(uid: string, mode: DisplayMode, settings: BarSettings): Promise<boolean> {
  const key = prefix(mode) + uid;
  const stored = await browser.storage.session.get(key);
  return (settings.autoHide ?? "off") !== "off" && stored[key] !== signature(settings);
}

export async function reconcileAutoHideOverrides(configs: BarConfigurations, menuUids?: readonly string[]): Promise<void> {
  const stored = await browser.storage.session.get(null);
  const removed: string[] = [];
  for (const mode of ["native", "browser"] as const) {
    for (const key of Object.keys(stored).filter(key => key.startsWith(prefix(mode)))) {
      const uid = key.slice(prefix(mode).length);
      const settings = mode === "native" ? resolveBarConfiguration(configs, "native", uid) : resolveBarConfiguration(configs, "browser", uid);
      if ((menuUids && !menuUids.includes(uid)) || stored[key] !== signature(settings)) removed.push(key);
    }
  }
  if (removed.length) await browser.storage.session.remove(removed);
}

export async function toggleAutoHide(uid: string): Promise<void> {
  const [config, mode, configs] = await Promise.all([loadConfig(), loadDisplayMode(), loadBarConfigurations()]);
  const index = config.panel.menus.findIndex(menu => menu.uid === uid);
  if (index < 0) throw new Error("Menu is unavailable");
  const settings = mode === "native" ? resolveBarConfiguration(configs, "native", uid, index) : resolveBarConfiguration(configs, "browser", uid, index);
  if ((settings.autoHide ?? "off") === "off") throw new Error(t("menuAction.autoHideUnavailable"));
  const key = prefix(mode) + uid;
  if (await autoHideEnabled(uid, mode, settings)) await browser.storage.session.set({ [key]: signature(settings) });
  else await browser.storage.session.remove(key);
}
