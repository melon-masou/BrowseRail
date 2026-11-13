import type { MessageSender } from "@browserail/runtime-adapter";
import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import { extension } from "../runtime";
import type { ExtensionConnectionState } from "@browserail/browserail/features/desktop/state-machine";
import { onLanguageChange, t } from "@browserail/i18n";
import {
  BROWSER_EDITING_STORAGE_KEY, WIDGET_ENABLED_STORAGE_KEY, SHORTCUTS_ENABLED_STORAGE_KEY,
  loadBrowserEditing, loadDisplayMode, loadWidgetEnabled, loadShortcutsEnabled,
  loadConfig, saveConfig, saveBrowserEditing, saveWidgetEnabled, saveShortcutsEnabled, type DisplayMode,
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
const ENABLE_MENU_ID = "browserail-enable";
const SHORTCUTS_MENU_ID = "browserail-shortcuts";
const MENU_ITEMS = [
  { id: ENABLE_MENU_ID, title: "action.enabled", type: "checkbox" },
  { id: EDIT_MENU_ID, title: "injection.editMenus", type: "checkbox" },
  { id: SHORTCUTS_MENU_ID, title: "section.shortcuts", type: "checkbox" },
  { id: ADD_STATIC_MENU_ID, title: "static.addCurrentPage", type: "normal" },
  { id: OPTIONS_MENU_ID, title: "action.openOptions", type: "normal" },
] as const;

export function createExtensionIconMenu(host: { setNativeEditing(editing: boolean): void }) {
  let nativeEditing: boolean | undefined;
  let contextMenuAvailable = true;
  const ready = Promise.resolve().then(() => extension.contextMenus.removeAll()).then(async () => {
    for (const item of MENU_ITEMS) await new Promise<void>((resolve, reject) => {
      extension.contextMenus.create({
        ...item, title: t(item.title), contexts: ["action", "page"],
        ...(item.type === "checkbox" ? { checked: false } : {}),
        ...(item.id === EDIT_MENU_ID ? { enabled: false } : {}),
      }, () => {
        const error = extension.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve();
      });
    });
  }).catch(error => {
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
    const [state, shortcutsEnabled] = await Promise.all([stateFor(mode, enabled), loadShortcutsEnabled()]);
    await getRuntimeAdapter().messaging.send({ type: EDITING_STATE_CHANGED, ...state } satisfies EditingStateChanged).catch(() => {});
    await ready;
    if (!contextMenuAvailable) return;
    const checkboxStates: Record<string, { checked: boolean; enabled?: boolean }> = {
      [ENABLE_MENU_ID]: { checked: enabled },
      [SHORTCUTS_MENU_ID]: { checked: shortcutsEnabled },
      [EDIT_MENU_ID]: { enabled: state.enabled, checked: state.editing },
    };
    for (const item of MENU_ITEMS)
      await extension.contextMenus.update(item.id, { title: t(item.title), ...checkboxStates[item.id] });
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
    if (info.menuItemId === ENABLE_MENU_ID || info.menuItemId === SHORTCUTS_MENU_ID) {
      const save = info.menuItemId === ENABLE_MENU_ID ? saveWidgetEnabled : saveShortcutsEnabled;
      void save(info.checked === true).then(async () => {
        await refresh();
        if (tab?.id !== undefined) await requestBrowserMenuRefresh(tab.id);
      }).catch(async error => {
        console.error("BrowseRail context menu:", error);
        await refresh();
      });
      return;
    }
    if (info.menuItemId === OPTIONS_MENU_ID) {
      void extension.runtime.openOptionsPage().catch(error => console.error("BrowseRail options:", error));
      return;
    }
    if (info.menuItemId === ADD_STATIC_MENU_ID) {
      const url = info.pageUrl ?? tab?.url;
      if (!url || tab?.id === undefined || tab.windowId === undefined) return;
      void openStaticConfirmation({ sourceTabId: tab.id, sourceWindowId: tab.windowId }, {
        name: tab.title || url, url,
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
    if (area === "local" && (changes[BROWSER_EDITING_STORAGE_KEY] || changes[WIDGET_ENABLED_STORAGE_KEY] || changes[SHORTCUTS_ENABLED_STORAGE_KEY])) {
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
