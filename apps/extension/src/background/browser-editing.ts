import browser, { type Runtime } from "webextension-polyfill";
import { onLanguageChange, t } from "@browserail/i18n";
import {
  BROWSER_EDITING_STORAGE_KEY, loadBrowserEditing, loadDisplayMode, loadWidgetEnabled,
  loadConfig, saveConfig, saveBrowserEditing, type DisplayMode,
} from "../config";
import { openStaticConfirmation, staticConfirmationContext } from "./temporary-confirmation";
import { requestBrowserMenuRefresh } from "./browser-menu-refresh";

const EDIT_MENU_ID = "browserail-edit-menus";
const ADD_STATIC_MENU_ID = "browserail-add-static-bookmark";
const OPTIONS_MENU_ID = "browserail-open-options";

export function createBrowserEditingMenu(host: { setNativeEditing(editing: boolean): void }) {
  let nativeEditing: boolean | undefined;
  const ready = browser.contextMenus.removeAll().then(() => new Promise<void>((resolve, reject) => {
    browser.contextMenus.create({
      id: EDIT_MENU_ID, type: "checkbox", title: t("injection.editMenus"), contexts: ["action"],
      checked: false, enabled: false,
    }, () => {
      const error = browser.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  })).then(() => new Promise<void>((resolve, reject) => {
    browser.contextMenus.create({
      id: ADD_STATIC_MENU_ID, title: t("static.addCurrentPage"), contexts: ["action"],
    }, () => {
      const error = browser.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  })).then(() => new Promise<void>((resolve, reject) => {
    browser.contextMenus.create({
      id: OPTIONS_MENU_ID, title: t("action.openOptions"), contexts: ["action"],
    }, () => {
      const error = browser.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  }));
  async function update(mode: DisplayMode, enabled: boolean): Promise<void> {
    const editing = mode === "browser" ? await loadBrowserEditing() : nativeEditing;
    await ready;
    const available = enabled && editing !== undefined;
    await browser.contextMenus.update(EDIT_MENU_ID, {
      title: t("injection.editMenus"), enabled: available, checked: available && editing === true,
    });
    await browser.contextMenus.update(ADD_STATIC_MENU_ID, { title: t("static.addCurrentPage") });
    await browser.contextMenus.update(OPTIONS_MENU_ID, { title: t("action.openOptions") });
  }
  const refresh = async (): Promise<void> => {
    const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
    await update(mode, enabled);
  };
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === OPTIONS_MENU_ID) {
      void browser.runtime.openOptionsPage().catch(error => console.error("BrowseRail options:", error));
      return;
    }
    if (info.menuItemId === ADD_STATIC_MENU_ID) {
      if (!tab?.url || tab.id === undefined || tab.windowId === undefined) return;
      void openStaticConfirmation({ sourceTabId: tab.id, sourceWindowId: tab.windowId }, {
        name: tab.title || tab.url, url: tab.url,
      }).catch(error => console.error("BrowseRail static bookmark:", error));
      return;
    }
    if (info.menuItemId !== EDIT_MENU_ID) return;
    void (async () => {
      const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
      if (enabled && mode === "native" && nativeEditing !== undefined) {
        host.setNativeEditing(info.checked === true);
        return;
      }
      if (mode === "browser" && enabled) await saveBrowserEditing(info.checked === true);
      await refresh();
      if (tab?.id !== undefined) await requestBrowserMenuRefresh(tab.id);
    })().catch(async error => {
      console.error("BrowseRail editing:", error);
      await refresh();
    });
  });
  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if ((message as { type?: string } | null)?.type !== "staticSaveConfirmed") return undefined;
    return saveStaticConfirmed(message, sender).then(() => ({ saved: true }), error => ({ error: String(error) }));
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[BROWSER_EDITING_STORAGE_KEY]) {
      void refresh().catch(error => console.error("BrowseRail editing:", error));
    }
  });
  onLanguageChange(() => { void refresh().catch(error => console.error("BrowseRail editing:", error)); });
  return {
    update,
    async updateNativeEditing(editing: boolean | undefined): Promise<void> {
      nativeEditing = editing;
      await refresh();
    },
  };
}

async function saveStaticConfirmed(message: unknown, sender: Runtime.MessageSender): Promise<void> {
  const source = staticConfirmationContext(sender);
  const { name, url } = message as { name?: unknown; url?: unknown };
  if (typeof name !== "string" || typeof url !== "string" || !url.trim()) throw new Error("Invalid static bookmark");
  const tab = await browser.tabs.get(source.sourceTabId);
  if (tab.windowId !== source.sourceWindowId) throw new Error("Source window is unavailable");
  const config = await loadConfig();
  config.staticBookmarks.push({ uid: crypto.randomUUID(), name: name.trim(), url: url.trim() });
  await saveConfig(config);
}
