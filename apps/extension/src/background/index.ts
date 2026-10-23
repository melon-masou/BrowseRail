import "../runtime";
import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import { extension } from "../runtime";
import { normalizeBarConfigurations } from "@browserail/protocol";
import { listBrowserWindows } from "@browserail/browserail/lib/browser/windows";
import {
  BAR_CONFIGURATIONS_STORAGE_KEY, loadConfig, loadDisplayMode, loadWidgetEnabled, removeBrowserPlacement,
  removeMenuPlacements, saveWidgetEnabled,
} from "@browserail/browserail/lib/config/index";
import { EXTERNAL_DATA_STORAGE_PREFIX } from "@browserail/browserail/lib/config/external-data";
import { executeMenuAction } from "@browserail/browserail/features/actions/execute-menu-action";
import { createShortcuts } from "../features/shortcuts";
import { initExternalUpdates } from "../features/external-updates";
import { reconcileAutoHideOverrides } from "@browserail/browserail/lib/config/auto-hide";
import { createBrowserMenus } from "@browserail/browserail/features/bar/menus";
import { requestBrowserMenuRefresh } from "@browserail/browserail/features/bar/refresh";
import { createDesktopConnection } from "@browserail/browserail/features/desktop/connection";
import { createDebugLog } from "@browserail/browserail/features/desktop/debug-log";
import { createWindowFocus } from "@browserail/browserail/features/desktop/focus";
import { initDynamicBookmarks } from "@browserail/browserail/features/dynamic/updater";
import { createMenuScriptRegistration } from "../features/content-scripts";
import { createMenuSync } from "@browserail/browserail/features/sync/index";
import { createExtensionIconBadge, createExtensionIconMenu } from "../features/extension-icon";
import { dispatch } from "@browserail/protocol/message";
import {
  DEBUG_INFO_REQUEST, DEBUG_LOGGING_SET, DESKTOP_RECONNECT, DESKTOP_RESYNC_WINDOWS, DESKTOP_STATE_CHANGED,
  DESKTOP_STATE_REQUEST, WIDGET_ENABLED_SET, isDesktopRequest, type DesktopRequest, type DesktopStateChanged,
} from "@browserail/browserail/features/desktop/messages";
import { MENU_LAYOUT_RESET, isMenuLayoutReset, type MenuLayoutReset } from "@browserail/browserail/features/bar/messages";
import { CONFIG_SAVED, isConfigSaved, type ConfigSaved } from "@browserail/browserail/lib/config/messages";

// Everything below registers synchronously at startup so browser events can wake the background.
const log = createDebugLog();
const focus = createWindowFocus();
const badge = createExtensionIconBadge();
const desktop = createDesktopConnection({
  log,
  focus,
  requestSync,
  editingChanged: editing => editingMenu.updateNativeEditing(editing),
  invoke: (actionUid, menuUid, windowUid) => actionUid.startsWith("shortcut:")
    ? shortcuts.executeNative(actionUid.slice("shortcut:".length), windowUid)
    : executeMenuAction(actionUid, menuUid, windowUid, requestSync),
});
const browserMenus = createBrowserMenus(requestSync);
const sync = createMenuSync({ log, focus, desktop, browserMenus, browserInjection: createMenuScriptRegistration() });
const editingMenu = createExtensionIconMenu({
  setNativeEditing(editing) {
    if (!desktop.isOpen()) throw new Error("Desktop is disconnected");
    desktop.send({ type: "setEditing", editing });
  },
});
const shortcuts = createShortcuts({
  requestSync,
  focusedWindowUid: focus.get,
  toggleNativeFold(menuUid) {
    if (!desktop.isOpen()) throw new Error("Desktop is disconnected");
    desktop.send({ type: "toggleMenuFold", menuUid });
  },
});

function requestSync(): Promise<void> {
  return sync.request();
}

desktop.state.subscribe((next, _prev, detail) => {
  if (next !== "connected" && next !== "syncing") {
    void editingMenu.updateNativeEditing(undefined).catch(error => console.error("BrowseRail editing:", error));
  }
  badge.update(next, detail);
  void getRuntimeAdapter().messaging.send({ type: DESKTOP_STATE_CHANGED, state: next, detail } satisfies DesktopStateChanged).catch(() => {});
});
badge.update(desktop.state.getState());

let reconcileGeneration = 0;
let reconcileTimer: ReturnType<typeof setTimeout> | undefined;

/** Applies the on/off switch, display mode and desktop address to the connection and the toolbar. */
async function reconcileConnection(forceReconnect = false): Promise<void> {
  clearTimeout(reconcileTimer);
  const generation = ++reconcileGeneration;
  const [config, enabled, mode] = await Promise.all([loadConfig(), loadWidgetEnabled(), loadDisplayMode()]);
  if (generation !== reconcileGeneration) return;
  badge.setActive(enabled);
  await editingMenu.update(mode, enabled);
  if (generation !== reconcileGeneration) return;
  await desktop.reconcile({ enabled: enabled && mode === "native", url: config.desktopWidget.url, label: config.instanceLabel, force: forceReconnect });
  badge.update(desktop.state.getState(), desktop.state.getDetail());
  void requestSync();
}

function scheduleReconcile(): void {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    void reconcileConnection();
  }, 50);
}

async function applyWidgetEnabled(enabled: boolean): Promise<void> {
  await saveWidgetEnabled(enabled);
  await reconcileConnection();
}

void reconcileConnection();

extension.windows
  .getLastFocused()
  .then((w) => {
    if (w && w.id !== undefined && (w.type === "normal" || w.type === undefined)) {
      focus.set(String(w.id));
      log.log("Window", `Initial lastFocusedWindowUid=${focus.get()}`);
      void requestSync();
    }
  })
  .catch(() => {});

extension.windows.onFocusChanged.addListener((windowId) => {
  log.log("Window", `onFocusChanged: windowId=${windowId}`);
  if (windowId >= 0) {
    focus.set(String(windowId));
    void requestSync();
  }
});
extension.windows.onCreated.addListener(() => {
  log.log("Window", "onCreated");
  void requestSync();
});
extension.windows.onRemoved.addListener((windowId) => {
  log.log("Window", `onRemoved: windowId=${windowId}`);
  desktop.forgetWindow(String(windowId));
  void requestSync();
});
const boundsChanged = (
  extension.windows as typeof extension.windows & {
    onBoundsChanged?: {
      addListener(listener: () => void): void;
    };
  }
).onBoundsChanged;
boundsChanged?.addListener(requestSync);
// Absent when the browser has no bookmarks API.
extension.bookmarkEvents?.onCreated.addListener(requestSync);
extension.bookmarkEvents?.onChanged.addListener(requestSync);
extension.bookmarkEvents?.onMoved.addListener(requestSync);
extension.bookmarkEvents?.onRemoved.addListener(requestSync);
extension.tabEvents?.onActivated?.addListener(() => { void requestSync(); });
extension.tabEvents?.onUpdated?.addListener(() => { void requestSync(); });
extension.tabEvents?.onReplaced?.addListener(() => { void requestSync(); });
extension.tabEvents?.onAttached?.addListener(() => { void requestSync(); });
extension.tabEvents?.onDetached?.addListener(() => { void requestSync(); });
initDynamicBookmarks(requestSync);
initExternalUpdates(requestSync);

getRuntimeAdapter().storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local" && changes[BAR_CONFIGURATIONS_STORAGE_KEY]) {
    await reconcileAutoHideOverrides(normalizeBarConfigurations(changes[BAR_CONFIGURATIONS_STORAGE_KEY]!.newValue));
  }
  if (areaName === "local" && Object.keys(changes).some(key => !key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX))) void requestSync();
  if (areaName === "local" && (changes.config || changes.widget_enabled || changes.display_mode)) {
    scheduleReconcile();
  }
});
extension.permissionEvents.onAdded.addListener(requestSync);
extension.permissionEvents.onRemoved.addListener(requestSync);

getRuntimeAdapter().messaging.onMessage.addListener((message: unknown) => {
  if (!isMenuLayoutReset(message) && !isConfigSaved(message) && !isDesktopRequest(message)) return;
  return dispatch<MenuLayoutReset | ConfigSaved | DesktopRequest>({
    [MENU_LAYOUT_RESET]: async ({ menuUid }) => {
      if (await loadDisplayMode() === "browser") await removeBrowserPlacement(menuUid);
      else { await removeMenuPlacements(menuUid); sync.resetNativeLayout(menuUid); }
      void requestSync();
      return { ok: true };
    },
    [CONFIG_SAVED]: () => reconcileConnection().then(() => ({ ok: true })),
    [DESKTOP_STATE_REQUEST]: async () => ({ state: desktop.state.getState(), detail: desktop.state.getDetail() }),
    [DEBUG_INFO_REQUEST]: async () => {
      const windows = await listBrowserWindows().catch(() => []);
      const connection = desktop.debugInfo();
      return {
        debugLoggingEnabled: log.enabled,
        connected: connection.connected,
        connectionState: desktop.state.getState(),
        connectionDetail: desktop.state.getDetail(),
        socketUrl: connection.socketUrl,
        instanceLabel: connection.instanceLabel,
        pairedWindowUids: connection.pairedWindowUids,
        pendingWindowPairings: connection.pendingWindowPairings,
        browserWindows: windows,
        recentLogs: log.entries,
      };
    },
    [DEBUG_LOGGING_SET]: ({ enabled }) => log.setEnabled(enabled),
    [DESKTOP_RECONNECT]: () => reconcileConnection(true).then(() => ({ ok: true })),
    [DESKTOP_RESYNC_WINDOWS]: () => desktop.rebuildWindows(),
    [WIDGET_ENABLED_SET]: async ({ enabled }) => {
      void applyWidgetEnabled(enabled);
      return { ok: true };
    },
  }, message);
});

// Clicking the toolbar icon toggles the widget on/off. Secondary clicks are
// ignored so the browser can show its built-in extension menu.
extension.action.onClicked.addListener((tab, info) => {
  if (info?.button !== undefined && info.button !== 0) return;
  void (async () => {
    await applyWidgetEnabled(!await loadWidgetEnabled());
    if (tab?.id !== undefined) await requestBrowserMenuRefresh(tab.id);
  })();
});
