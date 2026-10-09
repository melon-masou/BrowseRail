import browser from "webextension-polyfill";
import { normalizeBarConfigurations } from "@browserail/protocol";
import { listBrowserWindows } from "../lib/browser/windows";
import {
  BAR_CONFIGURATIONS_STORAGE_KEY, loadConfig, loadDisplayMode, loadWidgetEnabled, removeBrowserPlacement,
  removeMenuPlacements, saveWidgetEnabled,
} from "../lib/config";
import { EXTERNAL_DATA_STORAGE_PREFIX } from "../lib/config/external-data";
import { executeMenuAction } from "../features/actions/execute-menu-action";
import { createShortcuts } from "../features/actions/shortcuts";
import { initExternalUpdates } from "../features/api/updates";
import { reconcileAutoHideOverrides } from "../features/bar/auto-hide";
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
  void browser.runtime.sendMessage({ type: "desktopStateChanged", state: next, detail }).catch(() => {});
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
  if (typeof message !== "object" || message === null) return;
  const request = message as { type?: unknown; enabled?: unknown; menuUid?: unknown };
  switch (request.type) {
    case "getDesktopState":
      return Promise.resolve({ state: desktop.state.getState(), detail: desktop.state.getDetail() });
    case "getDebugInfo":
      return (async () => {
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
      })();
    case "setDebugLogging":
      return log.setEnabled(Boolean(request.enabled));
    case "manualReconnect":
      return reconcileConnection(true).then(() => ({ ok: true }));
    case "resyncWindows":
      return desktop.rebuildWindows();
    case "resetMenuLayout": {
      if (typeof request.menuUid !== "string") return;
      const menuUid = request.menuUid;
      return (async () => {
        if (await loadDisplayMode() === "browser") await removeBrowserPlacement(menuUid);
        else { await removeMenuPlacements(menuUid); sync.resetNativeLayout(menuUid); }
        void requestSync();
        return { ok: true };
      })();
    }
    case "configSaved":
      return reconcileConnection().then(() => ({ ok: true }));
    case "setWidgetEnabled":
      if (typeof request.enabled !== "boolean") return;
      void applyWidgetEnabled(request.enabled);
      return Promise.resolve({ ok: true });
  }
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
