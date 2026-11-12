import type { MessageSender } from "@browserail/runtime-adapter";
import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import { extension } from "../runtime";
import type { ExtensionConnectionState } from "@browserail/browserail/features/desktop/state-machine";
import { onLanguageChange, t } from "@browserail/i18n";
import {
  BROWSER_EDITING_STORAGE_KEY, loadBrowserEditing, loadDisplayMode, loadWidgetEnabled,
  loadConfig, saveConfig, saveBrowserEditing, type DisplayMode,
} from "@browserail/browserail/lib/config/index";
import { openStaticConfirmation, staticConfirmationContext } from "@browserail/browserail/features/capture/confirmation";
import { requestBrowserMenuRefresh } from "@browserail/browserail/features/bar/refresh";
import { normalizeBookmarkTags } from "@browserail/browserail/lib/config/bookmark-tags";
import { dispatch } from "@browserail/protocol/message";
import {
  EDITING_SET, EDITING_STATE_CHANGED, EDITING_STATE_REQUEST, isEditingRequest, type EditingRequest, type EditingState,
  type EditingStateChanged,
} from "@browserail/browserail/features/toolbar/messages";
import { STATIC_SAVE_CONFIRMED, isStaticSaveConfirmed, type CaptureResult, type StaticSaveConfirmed } from "@browserail/browserail/features/capture/messages";

const EDIT_MENU_ID = "browserail-edit-menus";
const ADD_STATIC_MENU_ID = "browserail-add-static-bookmark";
const OPTIONS_MENU_ID = "browserail-open-options";

export function createExtensionIconMenu(host: { setNativeEditing(editing: boolean): void }) {
  let nativeEditing: boolean | undefined;
  let contextMenuAvailable = true;
  const ready = Promise.resolve().then(() => extension.contextMenus.removeAll()).then(() => new Promise<void>((resolve, reject) => {
    extension.contextMenus.create({
      id: EDIT_MENU_ID, type: "checkbox", title: t("injection.editMenus"), contexts: ["action"],
      checked: false, enabled: false,
    }, () => {
      const error = extension.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  })).then(() => new Promise<void>((resolve, reject) => {
    extension.contextMenus.create({
      id: ADD_STATIC_MENU_ID, title: t("static.addCurrentPage"), contexts: ["action"],
    }, () => {
      const error = extension.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  })).then(() => new Promise<void>((resolve, reject) => {
    extension.contextMenus.create({
      id: OPTIONS_MENU_ID, title: t("action.openOptions"), contexts: ["action"],
    }, () => {
      const error = extension.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  })).catch(error => {
    contextMenuAvailable = false;
    console.error("BrowseRail context menu:", error);
  });
  async function getState() {
    const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
    return stateFor(mode, enabled);
  }
  async function stateFor(mode: DisplayMode, enabled: boolean): Promise<EditingState> {
    const editing = mode === "browser" ? await loadBrowserEditing() : nativeEditing;
    const available = enabled && editing !== undefined;
    return { enabled: available, editing: available && editing === true };
  }
  async function update(mode: DisplayMode, enabled: boolean): Promise<void> {
    const state = await stateFor(mode, enabled);
    await getRuntimeAdapter().messaging.send({ type: EDITING_STATE_CHANGED, ...state } satisfies EditingStateChanged).catch(() => {});
    await ready;
    if (!contextMenuAvailable) return;
    await extension.contextMenus.update(EDIT_MENU_ID, {
      title: t("injection.editMenus"), enabled: state.enabled, checked: state.editing,
    });
    await extension.contextMenus.update(ADD_STATIC_MENU_ID, { title: t("static.addCurrentPage") });
    await extension.contextMenus.update(OPTIONS_MENU_ID, { title: t("action.openOptions") });
  }
  const refresh = async (): Promise<void> => {
    const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
    await update(mode, enabled);
  };
  async function setEditing(editing: boolean, tabId?: number): Promise<void> {
    const [mode, enabled] = await Promise.all([loadDisplayMode(), loadWidgetEnabled()]);
    if (!enabled) return;
    if (mode === "native") {
      if (nativeEditing !== undefined) host.setNativeEditing(editing);
      return;
    }
    await saveBrowserEditing(editing);
    await refresh();
    const tabs = tabId === undefined ? await getRuntimeAdapter().navigation.query({}) : [{ id: tabId }];
    // Mobile browsers freeze background tabs, which then answer only once resumed; the toggle must not wait for them.
    for (const tab of tabs) if (tab.id !== undefined) void requestBrowserMenuRefresh(tab.id);
  }
  extension.contextMenus?.onClicked?.addListener((info, tab) => {
    if (info.menuItemId === OPTIONS_MENU_ID) {
      void extension.runtime.openOptionsPage().catch(error => console.error("BrowseRail options:", error));
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
    void setEditing(info.checked === true, tab?.id).catch(async error => {
      console.error("BrowseRail editing:", error);
      await refresh();
    });
  });
  getRuntimeAdapter().messaging.onMessage.addListener((message: unknown, sender: MessageSender) => {
    if (isEditingRequest(message)) {
      if (sender.id !== getRuntimeAdapter().messaging.id || sender.url?.split(/[?#]/)[0] !== getRuntimeAdapter().resourceUrl("options.html")) return undefined;
      return dispatch<EditingRequest>({
        [EDITING_STATE_REQUEST]: () => getState(),
        [EDITING_SET]: ({ editing }) => setEditing(editing).then(getState),
      }, message);
    }
    if (!isStaticSaveConfirmed(message)) return undefined;
    return dispatch<StaticSaveConfirmed>({
      [STATIC_SAVE_CONFIRMED]: confirmed => saveStaticConfirmed(confirmed, sender)
        .then((): CaptureResult => ({ saved: true }), (error): CaptureResult => ({ error: String(error) })),
    }, message);
  });
  getRuntimeAdapter().storage.onChanged.addListener((changes, area) => {
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

async function saveStaticConfirmed({ name, url, tags }: StaticSaveConfirmed, sender: MessageSender): Promise<void> {
  const source = staticConfirmationContext(sender);
  if (!url.trim()) throw new Error("Invalid static bookmark");
  const tab = await getRuntimeAdapter().navigation.get(source.sourceTabId);
  if (tab.windowId !== source.sourceWindowId) throw new Error("Source window is unavailable");
  const config = await loadConfig();
  const selectedTags = normalizeBookmarkTags(tags);
  config.staticBookmarks.push({ uid: crypto.randomUUID(), name: name.trim(), url: url.trim(), ...(selectedTags.length ? { tags: selectedTags } : {}) });
  await saveConfig(config);
}

/** The toolbar icon's badge and tooltip, reflecting whether BrowseRail is on and the desktop connection. */
export function createExtensionIconBadge() {
  let widgetActive = true;
  return {
    setActive(active: boolean): void { widgetActive = active; },
    update(state: ExtensionConnectionState, detail?: string): void {
      const disabled = !widgetActive;
      // Clicking the toolbar icon toggles enable/disable, so the tooltip states the
      // current state and what a click will do. When disabled, the corner badge
      // shows two blue bars with a transparent background.
      let title = disabled ? t("action.iconTitleDisabled") : t("action.iconTitleEnabled");
      switch (state) {
        case "connected":
          title = `${t("action.iconTitleEnabled")} — Connected (${detail ?? "Ready"})`;
          break;
        case "syncing":
          title = `${t("action.iconTitleEnabled")} — Syncing`;
          break;
        case "connecting":
        case "handshaking":
          title = `${t("action.iconTitleEnabled")} — Connecting…`;
          break;
        case "reconnecting":
          title = `${t("action.iconTitleEnabled")} — Reconnecting (${detail ?? ""})`;
          break;
        case "disconnected":
          title = `${t("action.iconTitleEnabled")} — Disconnected`;
          break;
        case "disabled":
          title = disabled ? t("action.iconTitleDisabled") : t("action.iconTitleEnabled");
          break;
      }
      void extension.action.setBadgeText({ text: disabled ? "OFF" : "" });
      if (disabled) {
        // Transparent background so only the two blue bars show, at the corner.
        void extension.action.setBadgeTextColor?.({ color: "#2563eb" });
        void extension.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
      }
      void extension.action.setTitle({ title });
    },
  };
}
