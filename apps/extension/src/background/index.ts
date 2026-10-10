import browser from "webextension-polyfill";
import { normalizeBarConfigurations } from "@browserail/protocol";
import { listBrowserWindows } from "../lib/browser/windows";
import {
  BAR_CONFIGURATIONS_STORAGE_KEY, loadConfig, loadDisplayMode, loadWidgetEnabled, removeBrowserPlacement,
  removeMenuPlacements, saveWidgetEnabled,
} from "../lib/config";
import { EXTERNAL_DATA_STORAGE_PREFIX } from "../lib/config/external-data";
import { executeMenuAction } from "../features/actions/execute-menu-action";
import { createShortcuts } from "../features/shortcuts/index";
import { initExternalUpdates } from "../features/api/updates";
import { reconcileAutoHideOverrides } from "../lib/config/auto-hide";
import { createBrowserMenus } from "../features/bar/menus";
import { requestBrowserMenuRefresh } from "../features/bar/refresh";
import { createDesktopConnection } from "../features/desktop/connection";
import { createDebugLog } from "../features/desktop/debug-log";
import { createWindowFocus } from "../features/desktop/focus";
import { initDynamicBookmarks } from "../features/dynamic/updater";
import { createBrowserInjection } from "../features/injection/bar";
import { createMenuSync } from "../features/sync";
import { createToolbarBadge } from "../features/toolbar/badge";
import { createBrowserEditingMenu } from "../features/toolbar/menu";
import { dispatch } from "@browserail/protocol/message";
import {
  DEBUG_INFO_REQUEST, DEBUG_LOGGING_SET, DESKTOP_RECONNECT, DESKTOP_RESYNC_WINDOWS, DESKTOP_STATE_CHANGED,
  DESKTOP_STATE_REQUEST, WIDGET_ENABLED_SET, isDesktopRequest, type DesktopRequest, type DesktopStateChanged,
} from "../features/desktop/messages";
import { MENU_LAYOUT_RESET, isMenuLayoutReset, type MenuLayoutReset } from "../features/bar/messages";
import { CONFIG_SAVED, isConfigSaved, type ConfigSaved } from "../lib/config/messages";

// Everything below registers synchronously at startup so browser events can wake the background.
const log = createDebugLog();
const focus = createWindowFocus();
const badge = createToolbarBadge();
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
const sync = createMenuSync({ log, focus, desktop, browserMenus, browserInjection: createBrowserInjection() });
const editingMenu = createBrowserEditingMenu({
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
  void browser.runtime.sendMessage({ type: DESKTOP_STATE_CHANGED, state: next, detail } satisfies DesktopStateChanged).catch(() => {});
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

browser.windows
  .getLastFocused()
  .then((w) => {
    if (w && w.id !== undefined && (w.type === "normal" || w.type === undefined)) {
      focus.set(String(w.id));
      log.log("Window", `Initial lastFocusedWindowUid=${focus.get()}`);
      void requestSync();
    }
  })
  .catch(() => {});

browser.windows.onFocusChanged.addListener((windowId) => {
  log.log("Window", `onFocusChanged: windowId=${windowId}`);
  if (windowId >= 0) {
    focus.set(String(windowId));
    void requestSync();
  }
});
browser.windows.onCreated.addListener(() => {
  log.log("Window", "onCreated");
  void requestSync();
});
browser.windows.onRemoved.addListener((windowId) => {
  log.log("Window", `onRemoved: windowId=${windowId}`);
  desktop.forgetWindow(String(windowId));
  void requestSync();
});
const boundsChanged = (
  browser.windows as typeof browser.windows & {
    onBoundsChanged?: {
      addListener(listener: () => void): void;
    };
  }
).onBoundsChanged;
boundsChanged?.addListener(requestSync);
// Absent when the browser has no bookmarks API.
browser.bookmarks?.onCreated.addListener(requestSync);
browser.bookmarks?.onChanged.addListener(requestSync);
browser.bookmarks?.onMoved.addListener(requestSync);
browser.bookmarks?.onRemoved.addListener(requestSync);
browser.tabs?.onActivated?.addListener(() => { void requestSync(); });
browser.tabs?.onUpdated?.addListener(() => { void requestSync(); });
browser.tabs?.onReplaced?.addListener(() => { void requestSync(); });
browser.tabs?.onAttached?.addListener(() => { void requestSync(); });
browser.tabs?.onDetached?.addListener(() => { void requestSync(); });
initDynamicBookmarks(requestSync);
initExternalUpdates(requestSync);

browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local" && changes[BAR_CONFIGURATIONS_STORAGE_KEY]) {
    await reconcileAutoHideOverrides(normalizeBarConfigurations(changes[BAR_CONFIGURATIONS_STORAGE_KEY]!.newValue));
  }
  if (areaName === "local" && Object.keys(changes).some(key => !key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX))) void requestSync();
  if (areaName === "local" && (changes.config || changes.widget_enabled || changes.display_mode)) {
    scheduleReconcile();
  }
});
browser.permissions.onAdded.addListener(requestSync);
browser.permissions.onRemoved.addListener(requestSync);

browser.runtime.onMessage.addListener((message: unknown) => {
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
browser.action.onClicked.addListener((tab, info) => {
  if (info?.button !== undefined && info.button !== 0) return;
  void (async () => {
    await applyWidgetEnabled(!await loadWidgetEnabled());
    if (tab?.id !== undefined) await requestBrowserMenuRefresh(tab.id);
  })();
});
