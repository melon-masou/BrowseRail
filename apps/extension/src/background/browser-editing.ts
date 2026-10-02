import browser from "webextension-polyfill";
import { onLanguageChange, t } from "@browserail/i18n";
import {
  BROWSER_EDITING_STORAGE_KEY, loadBrowserEditing, loadDisplayMode, loadWidgetEnabled,
  saveBrowserEditing, type DisplayMode,
} from "../config";

const EDIT_MENU_ID = "browserail-edit-menus";

export function createBrowserEditingMenu() {
  const ready = browser.contextMenus.removeAll().then(() => new Promise<void>((resolve, reject) => {
    browser.contextMenus.create({
      id: EDIT_MENU_ID, type: "checkbox", title: t("injection.editMenus"), contexts: ["action"],
      checked: false, enabled: false,
    }, () => {
      const error = browser.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  }));
  async function update(mode: DisplayMode, enabled: boolean): Promise<void> {
    const editing = await loadBrowserEditing();
    await ready;
    const available = mode === "browser" && enabled;
    await browser.contextMenus.update(EDIT_MENU_ID, {
      title: t("injection.editMenus"), enabled: available, checked: available && editing,
    });
  }
  const refresh = async (): Promise<void> => {
    const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
    await update(mode, enabled);
  };
  browser.contextMenus.onClicked.addListener(info => {
    if (info.menuItemId !== EDIT_MENU_ID) return;
    void (async () => {
      const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
      if (mode === "browser" && enabled) await saveBrowserEditing(info.checked === true);
      await refresh();
    })().catch(error => console.error("BrowseRail editing:", error));
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[BROWSER_EDITING_STORAGE_KEY]) {
      void refresh().catch(error => console.error("BrowseRail editing:", error));
    }
  });
  onLanguageChange(() => { void refresh().catch(error => console.error("BrowseRail editing:", error)); });
  return { update };
}
