import browser from "webextension-polyfill";
import { type ShortcutAction } from "@browserail/protocol";
import { loadShortcutsEnabled, saveShortcutsEnabled, saveConfig, type ExtensionConfig } from "../../lib/config";
import { runTabAction, toggleTargetMenus } from "./menu-actions";
import { toggleAutoHide } from "../bar/auto-hide";

export async function canExecuteShortcut(type: unknown): Promise<boolean> {
  return type === "shortcutsToggle" || await loadShortcutsEnabled();
}

export async function executeShortcutAction(
  action: ShortcutAction,
  config: ExtensionConfig,
  windowUid: string,
  host: { changed(): void | Promise<void>; toggleFold(menuUid: string): Promise<void> },
): Promise<void> {
  if (action.type === "browserAction") {
    await runTabAction(browser.tabs, windowUid, action.browserAction);
  } else if (action.type === "shortcutsToggle") {
    await saveShortcutsEnabled(!await loadShortcutsEnabled());
  } else if (action.type === "menusToggle") {
    const menus = toggleTargetMenus(config.panel.menus, undefined, action.targetMenuUids);
    if (menus) await saveConfig({ ...config, panel: { menus } });
  } else if (action.type === "autoHideToggle") {
    await toggleAutoHide(action.menuUid);
  } else {
    if (!config.panel.menus.some(menu => menu.uid === action.menuUid)) throw new Error("Menu is unavailable");
    await host.toggleFold(action.menuUid);
  }
  await host.changed();
}
