import {
  isDynamicAction,
  isNativeMessage,
  isUrlMatchingSet,
  parseDynamicAction,
  PROTOCOL_VERSION,
  type BrowserInstance,
  type ExtensionMessage,
  type MenuView,
  type SyncedMenu,
  type SyncedNativeShortcut,
} from "@browserail/protocol";
import { t } from "@browserail/i18n";
import browser from "webextension-polyfill";

import {
  type BookmarkNode,
  combineRootAndItemPath,
  findBookmarkNodeByPath,
  resolveMenuItems,
} from "../bookmarks";
import { createBookmarkTargetDraft } from "../bookmark-registry";
import { browserKind, listBrowserWindows, type BrowserWindowCandidate } from "../browser-adapter";
import {
  DEFAULT_FONT_SIZE,
  type ExtensionConfig,
  loadBookmarkRootPrefix,
  loadConfig,
  loadFreePlacements,
  loadMenuPlacements,
  loadWidgetEnabled,
  loadDynamicValues,
  removeMenuPlacements,
  resolveGapPx,
  resolveMenuPlacement,
  saveFreePlacement,
  saveMenuPlacement,
  saveWidgetEnabled,
} from "../config";
import { loadInstanceUid } from "../instance-identity";
import { ExtensionStateMachine, type ExtensionConnectionState } from "../state-machine";
import { navigateBookmark, navigateToUrl } from "../tab-actions/navigate";
import { initDynamicBookmarks } from "./dynamic";

export const connectionStateMachine = new ExtensionStateMachine("disconnected");

connectionStateMachine.subscribe((next, _prev, detail) => {
  updateActionBadge(next, detail);
  void browser.runtime
    .sendMessage({
      type: "desktopStateChanged",
      state: next,
      detail,
    })
    .catch(() => {});
});

function updateActionBadge(state: ExtensionConnectionState, detail?: string): void {
  const disabled = state === "disabled";
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
      title = t("action.iconTitleDisabled");
      break;
  }
  void browser.action.setBadgeText({ text: disabled ? "OFF" : "" });
  if (disabled) {
    // Transparent background so only the two blue bars show, at the corner.
    void browser.action.setBadgeTextColor?.({ color: "#2563eb" });
    void browser.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
  }
  void browser.action.setTitle({ title });
}

updateActionBadge(connectionStateMachine.getState());

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 3_000;
let socket: WebSocket | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let revision = 0;
let syncRequested = false;
let syncRunning = false;
const resetMenuUids = new Set<string>();
let connectionGeneration = 0;
let connectionEnabled = false;
let desiredInstanceLabel = "";
let desiredSocketUrl = "";
const pairedWindowUids = new Set<string>();
const pendingWindowPairings = new Map<string, string>();
const pendingResyncs = new Map<
  string,
  {
    resolve: (result: { ok: boolean; message: string }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

export interface ExtensionDebugLogEntry {
  time: string;
  tag: string;
  message: string;
  details?: unknown;
}

let debugLoggingEnabled = false;
const debugLogs: ExtensionDebugLogEntry[] = [];
const MAX_DEBUG_LOGS = 250;

void browser.storage.local
  .get("debugLoggingEnabled")
  .then((res) => {
    debugLoggingEnabled = Boolean(res.debugLoggingEnabled);
  })
  .catch(() => {});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.debugLoggingEnabled) {
    debugLoggingEnabled = Boolean(changes.debugLoggingEnabled.newValue);
    if (!debugLoggingEnabled) {
      debugLogs.length = 0;
    } else {
      extLog("Debug", "Debug logging enabled");
    }
  }
});

function extLog(tag: string, message: string, details?: unknown): void {
  if (!debugLoggingEnabled) return;

  const time = new Date().toISOString();
  const entry: ExtensionDebugLogEntry = { time, tag, message, details };
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.shift();
  }
  console.log(`[BrowseRail][${tag}] ${message}`, details !== undefined ? details : "");

  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(
        JSON.stringify({
          type: "clientDebugLog",
          time,
          tag,
          message,
          details,
        }),
      );
    } catch {
      // ignore
    }
  }
}

let lastFocusedWindowUid: string | undefined;

void reconcileConnection();

browser.windows
  .getLastFocused()
  .then((w) => {
    if (w && w.id !== undefined && (w.type === "normal" || w.type === undefined)) {
      lastFocusedWindowUid = String(w.id);
      extLog("Window", `Initial lastFocusedWindowUid=${lastFocusedWindowUid}`);
      requestSync();
    }
  })
  .catch(() => {});

browser.windows.onFocusChanged.addListener((windowId) => {
  extLog("Window", `onFocusChanged: windowId=${windowId}`);
  if (windowId >= 0) {
    lastFocusedWindowUid = String(windowId);
    requestSync();
  }
});
browser.windows.onCreated.addListener(() => {
  extLog("Window", "onCreated");
  requestSync();
});
browser.windows.onRemoved.addListener((windowId) => {
  const windowUid = String(windowId);
  extLog("Window", `onRemoved: windowId=${windowId}`);
  pairedWindowUids.delete(windowUid);
  for (const [requestUid, pendingWindowUid] of pendingWindowPairings) {
    if (pendingWindowUid === windowUid) {
      pendingWindowPairings.delete(requestUid);
    }
  }
  requestSync();
});
const boundsChanged = (
  browser.windows as typeof browser.windows & {
    onBoundsChanged?: {
      addListener(listener: () => void): void;
    };
  }
).onBoundsChanged;
boundsChanged?.addListener(requestSync);
browser.bookmarks.onCreated.addListener(requestSync);
browser.bookmarks.onChanged.addListener(requestSync);
browser.bookmarks.onMoved.addListener(requestSync);
browser.bookmarks.onRemoved.addListener(requestSync);
browser.tabs?.onActivated?.addListener(() => {
  requestSync();
});
browser.tabs?.onUpdated?.addListener(() => {
  requestSync();
});
browser.tabs?.onReplaced?.addListener(() => {
  requestSync();
});
browser.tabs?.onAttached?.addListener(() => {
  requestSync();
});
browser.tabs?.onDetached?.addListener(() => {
  requestSync();
});
initDynamicBookmarks(requestSync);
let reconcileTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleReconcile(): void {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    void reconcileConnection();
  }, 50);
}

let previewConfigOverride: ExtensionConfig | null = null;

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.config || changes.widget_enabled)) {
    previewConfigOverride = null;
    scheduleReconcile();
  }
  if (areaName === "sync" && changes.sync_menus) {
    previewConfigOverride = null;
    scheduleReconcile();
  }
});
browser.runtime.onMessage.addListener((message: unknown) => {
  if (isGetStateMessage(message)) {
    return Promise.resolve({
      state: connectionStateMachine.getState(),
      detail: connectionStateMachine.getDetail(),
    });
  }
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "previewConfig" &&
    "config" in message
  ) {
    previewConfigOverride = (message as { config: ExtensionConfig }).config;
    requestSync();
    return Promise.resolve({ ok: true, message: "Preview updated" });
  }
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "cancelPreview"
  ) {
    if (previewConfigOverride !== null) {
      previewConfigOverride = null;
      requestSync();
    }
    return Promise.resolve({ ok: true });
  }
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "getDebugInfo"
  ) {
    return (async () => {
      const windows = await listBrowserWindows().catch(() => []);
      return {
        debugLoggingEnabled,
        connected: socket?.readyState === WebSocket.OPEN,
        connectionState: connectionStateMachine.getState(),
        connectionDetail: connectionStateMachine.getDetail(),
        socketUrl: desiredSocketUrl,
        instanceLabel: desiredInstanceLabel,
        pairedWindowUids: Array.from(pairedWindowUids),
        pendingWindowPairings: Array.from(pendingWindowPairings.entries()).map(
          ([requestUid, windowUid]) => ({ requestUid, windowUid }),
        ),
        browserWindows: windows,
        recentLogs: debugLogs,
      };
    })();
  }
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: string }).type === "setDebugLogging"
  ) {
    const enabled = Boolean((message as { enabled?: boolean }).enabled);
    debugLoggingEnabled = enabled;
    if (!enabled) {
      debugLogs.length = 0;
    } else {
      extLog("Debug", "Debug logging enabled");
    }
    return browser.storage.local
      .set({ debugLoggingEnabled: enabled })
      .then(() => ({ ok: true, debugLoggingEnabled }));
  }
  if (isManualReconnectMessage(message)) {
    manualReconnect();
    return Promise.resolve({ ok: true });
  }
  if (isResyncWindowsMessage(message)) {
    return rebuildDesktopWindows();
  }
  if (isResetMenuLayoutMessage(message)) {
    return removeMenuPlacements(message.menuUid).then(() => {
      resetMenuUids.add(message.menuUid);
      requestSync();
      return { ok: true };
    });
  }
  if (isConfigSavedMessage(message)) {
    previewConfigOverride = null;
    scheduleReconcile();
  }
  if (isSetWidgetEnabledMessage(message)) {
    void applyWidgetEnabled(message.enabled);
    return Promise.resolve({ ok: true });
  }
});
// Clicking the toolbar icon toggles the widget on/off. Secondary clicks are
// ignored so the browser can show its built-in extension menu.
browser.action.onClicked.addListener((_tab, info) => {
  if (info?.button !== undefined && info.button !== 0) return;
  void toggleWidgetEnabled();
});

async function applyWidgetEnabled(enabled: boolean): Promise<void> {
  connectionEnabled = enabled;
  await saveWidgetEnabled(enabled);
  if (!enabled) {
    stopConnection();
  } else {
    scheduleReconcile();
  }
}

async function toggleWidgetEnabled(): Promise<void> {
  const enabled = await loadWidgetEnabled();
  await applyWidgetEnabled(!enabled);
}

async function reconcileConnection(): Promise<void> {
  clearTimeout(reconcileTimer);
  const generation = ++connectionGeneration;
  const [config, enabled] = await Promise.all([loadConfig(), loadWidgetEnabled()]);
  if (generation !== connectionGeneration) {
    return;
  }

  connectionEnabled = enabled;
  const connectionMatches =
    desiredSocketUrl === config.desktopWidget.url &&
    desiredInstanceLabel === config.instanceLabel &&
    socket !== undefined &&
    (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN);

  desiredSocketUrl = config.desktopWidget.url;
  desiredInstanceLabel = config.instanceLabel;

  if (!connectionEnabled) {
    stopConnection();
  } else if (connectionMatches) {
    requestSync();
  } else {
    stopConnection();
    connectionStateMachine.transition("disconnected", "Connection parameters changed");
    await connect(generation);
  }
}

async function connect(generation = connectionGeneration): Promise<void> {
  clearTimeout(reconnectTimer);
  const instance = await loadInstance(desiredInstanceLabel);
  if (!connectionEnabled || generation !== connectionGeneration) {
    return;
  }
  connectionStateMachine.transition("connecting", `Connecting to ${desiredSocketUrl}`);
  extLog("Connect", `Connecting to ${desiredSocketUrl} (gen ${generation})`);
  let nextSocket: WebSocket;
  try {
    nextSocket = new WebSocket(desiredSocketUrl);
  } catch (err) {
    extLog("Connect", `WebSocket constructor threw error: ${String(err)}`);
    reconnect();
    return;
  }
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) {
      return;
    }
    connectionStateMachine.transition(
      "handshaking",
      `WebSocket opened, sending hello (instance: ${instance.uid})`,
    );
    extLog("Connect", `WebSocket opened, sending hello (instance: ${instance.uid}, browser: ${instance.browser})`);
    send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      instance,
    });
    startHeartbeat();
  });
  nextSocket.addEventListener("message", (event) => {
    if (socket === nextSocket) {
      void handleMessage(event.data);
    }
  });
  nextSocket.addEventListener("close", () => {
    if (socket === nextSocket) {
      extLog("Connect", "WebSocket closed");
      socket = undefined;
      reconnect();
    }
  });
  nextSocket.addEventListener("error", () => {
    extLog("Connect", "WebSocket connection error");
  });
}

async function handleMessage(raw: unknown): Promise<void> {
  if (typeof raw !== "string") {
    return;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }

  if (!isNativeMessage(value)) {
    return;
  }

  if (value.type === "ready") {
    reconnectAttempts = 0;
    connectionStateMachine.transition("connected", `Handshake completed, protocol v${value.protocolVersion}`);
    extLog("Protocol", `Handshake completed, protocol v${value.protocolVersion}`);
    requestSync();
    return;
  }

  if (value.type === "resyncComplete") {
    const pending = pendingResyncs.get(value.requestUid);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingResyncs.delete(value.requestUid);
      pairedWindowUids.clear();
      pendingWindowPairings.clear();
      requestSync();
      pending.resolve({ ok: true, message: "Windows rebuilt" });
    }
    return;
  }

  if (value.type === "invoke") {
    if (value.actionUid.startsWith("noop")) {
      return;
    }
    // Bound menus carry a fixed target window. A free (detached) surface
    // omits windowUid, so the target is resolved here as the instance's current
    // lastFocused window. No available window → silently drop (spec: no log, no
    // error, no fallback, no foregrounding).
    const targetWindowUid = value.windowUid ?? lastFocusedWindowUid;
    if (!targetWindowUid) {
      return;
    }
    try {
      if (value.actionUid.startsWith("shortcut:")) {
        const shortcutId = value.actionUid.slice("shortcut:".length);
        await executeNativeShortcut(shortcutId, targetWindowUid);
      } else if (isDynamicAction(value.actionUid)) {
        const { dynamicUid, tabMode } = parseDynamicAction(value.actionUid);
        const live = (await loadDynamicValues())[dynamicUid];
        if (live?.url) {
          await navigateToUrl(browser, targetWindowUid, live.url, tabMode);
        }
      } else {
        await navigateBookmark(browser, targetWindowUid, value.actionUid);
      }
    } catch {
      requestSync();
    }
    return;
  }

  if (value.type === "verifyWindowPairing") {
    const pendingWindowUid = pendingWindowPairings.get(value.requestUid);
    extLog(
      "Pairing",
      `verifyWindowPairing received: req=${value.requestUid}, win=${value.windowUid}, expected=${pendingWindowUid}`,
    );
    if (pendingWindowUid !== value.windowUid) {
      extLog("Pairing", "verifyWindowPairing ignored: pending mismatch");
      return;
    }
    try {
      const window = await browser.windows.get(Number(value.windowUid));
      extLog(
        "Pairing",
        `browser.windows.get(${value.windowUid}) result: focused=${window.focused}, state=${window.state}, type=${window.type}`,
      );
      if (window.focused === true) {
        extLog(
          "Pairing",
          `confirming window pairing for req=${value.requestUid}, win=${value.windowUid}`,
        );
        send({
          type: "confirmWindowPairing",
          requestUid: value.requestUid,
          windowUid: value.windowUid,
        });
      } else {
        extLog(
          "Pairing",
          `NOT confirming pairing: window.focused is not true (it is ${window.focused})`,
        );
      }
    } catch (err) {
      extLog("Pairing", `browser.windows.get(${value.windowUid}) threw error`, err);
      pendingWindowPairings.delete(value.requestUid);
    }
    return;
  }

  if (value.type === "pairWindowResult") {
    const pendingWindowUid = pendingWindowPairings.get(value.requestUid);
    pendingWindowPairings.delete(value.requestUid);
    extLog(
      "Pairing",
      `pairWindowResult: req=${value.requestUid}, win=${value.windowUid}, ok=${value.ok}, pendingUid=${pendingWindowUid}`,
    );
    if (value.ok && pendingWindowUid === value.windowUid) {
      pairedWindowUids.add(value.windowUid);
      extLog(
        "Pairing",
        `Successfully paired window ${value.windowUid}. Total paired: ${pairedWindowUids.size}`,
      );
    } else {
      extLog("Pairing", `Pairing failed or mismatch for window ${value.windowUid}`);
    }
    return;
  }

  if (value.type === "updateMenuPlacement") {
    await saveMenuPlacement(value.menuUid, value.placement);
    requestSync();
  }

  if (value.type === "updateFreePlacement") {
    await saveFreePlacement(value.menuUid, { x: value.x, y: value.y });
    requestSync();
  }
}

function requestSync(): void {
  syncRequested = true;
  if (!syncRunning) {
    void drainSync();
  }
}

async function drainSync(): Promise<void> {
  syncRunning = true;
  try {
    while (syncRequested) {
      syncRequested = false;
      await syncOnce();
    }
  } finally {
    syncRunning = false;
  }
}

async function syncOnce(): Promise<void> {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  const [loadedConfig, windows, placements, rootPrefix, freePlacements, bookmarkTree, dynamicValues] = await Promise.all([
    loadConfig(),
    listBrowserWindows(),
    loadMenuPlacements(),
    loadBookmarkRootPrefix(),
    loadFreePlacements(),
    browser.bookmarks.getTree().catch(() => []),
    loadDynamicValues(),
  ]);
  const config = previewConfigOverride ?? loadedConfig;
  const dynamicByUid = new Map((config.dynamicBookmarks ?? []).map((db) => [db.uid, db]));
  const dynamicResolve = (dynamicUid: string) => {
    const def = dynamicByUid.get(dynamicUid);
    if (!def) return undefined;
    const value = dynamicValues[dynamicUid];
    return {
      name: def.name,
      ...(value?.url ? { url: value.url } : {}),
      ...(value?.title ? { title: value.title } : {}),
    };
  };
  const activeMenus = config.panel.menus.filter((menu) => menu.enabled !== false);
  const bookmarkTargets = createBookmarkTargetDraft();
  const menuStates = await Promise.all(
    activeMenus.map(async (menu, index) => {
      const items = await resolveMenuItems(
        menu.items,
        menu.tabMode,
        menu.color,
        menu.expandDirection,
        rootPrefix,
        {
          tree: bookmarkTree as BookmarkNode[],
          registerTarget: (browserBookmarkId) => bookmarkTargets.register(browserBookmarkId),
          dynamicResolve,
        },
      );
      const placement = resolveMenuPlacement(
        placements[menu.uid],
        index,
        menu.orientation,
        0,
        menu.buttonFontSize,
      );
      const attachmentMode = menu.attachmentMode ?? "lastFocused";
      const view: MenuView = {
        uid: menu.uid,
        items,
        orientation: menu.orientation,
        ...(menu.color ? { color: menu.color } : {}),
        ...(menu.dockColor ? { dockColor: menu.dockColor } : {}),
        ...(menu.opacity !== undefined ? { opacity: menu.opacity } : {}),
        ...(menu.expandDirection ? { expandDirection: menu.expandDirection } : {}),
        buttonFontSize: menu.buttonFontSize ?? DEFAULT_FONT_SIZE,
        popupFontSize: menu.popupFontSize ?? DEFAULT_FONT_SIZE,
        gap: resolveGapPx(menu.buttonFontSize, menu.gap),
      };
      return {
        uid: menu.uid,
        isFree: attachmentMode === "free",
        view,
        placement,
        attachmentMode,
        onTopMode:
          attachmentMode === "free"
            ? ("alwaysOnTop" as const)
            : menu.onTopMode ?? "aboveBrowser",
      };
    }),
  );
  bookmarkTargets.commit();
  updateLastFocusedWindow(windows);

  const urlRules = config.urlRules;
  const urlRuleMap = new Map(urlRules.map((ws) => [ws.uid, ws]));
  const origByUid = new Map(activeMenus.map((m) => [m.uid, m]));

  // A menu with no URL rules is always visible; otherwise it must match the
  // given tab URL against at least one of its rules.
  const menuVisibleForUrl = (menuUid: string, activeTabUrl: string | undefined): boolean => {
    const setUids = origByUid.get(menuUid)?.urlRuleUids;
    if (!setUids || setUids.length === 0) return true;
    return (
      Boolean(activeTabUrl) &&
      setUids.some((setUid) => {
        const ws = urlRuleMap.get(setUid);
        return ws ? isUrlMatchingSet(activeTabUrl!, ws.patterns) : false;
      })
    );
  };

  // Bound menus are emitted once for each browser window because URL visibility, focus state,
  // geometry, and the native owner are window-specific.
  const boundMenus = menuStates.filter((menu) => !menu.isFree);
  const syncedBoundMenus: SyncedMenu[] = windows.flatMap((window) => {
    const windowSnapshot = {
      uid: window.uid,
      bounds: window.bounds,
      focused: window.uid === lastFocusedWindowUid,
    };
    return boundMenus.map((menu) => ({
      view: menu.view,
      placement: menu.placement,
      native: {
        attachmentMode: menu.attachmentMode,
        onTopMode: menu.onTopMode,
        visible: menuVisibleForUrl(menu.uid, window.activeTabUrl),
      },
      target: { kind: "window" as const, window: windowSnapshot },
    }));
  });

  const lastFocusedWindow =
    windows.find((w) => w.uid === lastFocusedWindowUid) ?? windows.find((w) => w.focused);
  // A free menu is emitted exactly once for the instance while it has a browser window.
  // URL matching only toggles native.visible (hidden-but-kept), same as bound menus, so a
  // URL change never destroys and recreates the free surface.
  const syncedFreeMenus: SyncedMenu[] = windows.length === 0
    ? []
    : menuStates
        .filter((menu) => menu.isFree)
        .map((menu) => {
          const pos = freePlacements[menu.uid];
          return {
            view: menu.view,
            placement: { ...menu.placement, ...(pos ? { freePosition: pos } : {}) },
            native: {
              attachmentMode: "free" as const,
              onTopMode: menu.onTopMode,
              visible: menuVisibleForUrl(menu.uid, lastFocusedWindow?.activeTabUrl),
            },
            target: {
              kind: "free" as const,
              ...(lastFocusedWindow
                ? {
                    referenceWindow: {
                      uid: lastFocusedWindow.uid,
                      bounds: lastFocusedWindow.bounds,
                      focused: lastFocusedWindow.uid === lastFocusedWindowUid,
                    },
                  }
                : {}),
            },
          };
        });

  const syncedMenus = [...syncedBoundMenus, ...syncedFreeMenus];
  const hasActiveAttachment = syncedBoundMenus.some(({ native }) => native.visible);
  const hasAllAttachment = syncedBoundMenus.some(
    ({ native }) => native.attachmentMode === "all",
  );

  extLog(
    "Sync",
    `syncOnce: totalWindows=${windows.length}, menus=${menuStates.length}, free=${syncedFreeMenus.length}, lastFocused=${lastFocusedWindowUid}, rev=${revision + 1}`,
  );

  const rawNativeShortcuts = config.nativeShortcuts ?? [];
  const nativeShortcuts: SyncedNativeShortcut[] = rawNativeShortcuts
    .filter(
      (s) =>
        s.key &&
        s.key.trim().length > 0 &&
        (s.type === "dynamic" ? Boolean(s.dynamicUid) : Boolean(s.path || s.url)),
    )
    .map((s) => ({
      id: s.id,
      key: s.key.trim(),
    }));

  send({
    type: "sync",
    revision: ++revision,
    menus: syncedMenus,
    ...(resetMenuUids.size > 0 ? { resetMenuUids: Array.from(resetMenuUids) } : {}),
    ...(nativeShortcuts.length > 0 ? { nativeShortcuts } : {}),
  });
  resetMenuUids.clear();

  if (hasActiveAttachment) {
    const windowUids = new Set(
      syncedBoundMenus
        .filter(({ target }) => target.kind === "window" && (target.window.focused || hasAllAttachment))
        .map(({ target }) => (target.kind === "window" ? target.window.uid : "")),
    );
    for (const windowUid of windowUids) {
      requestWindowPairing(windowUid);
    }
  }
}

function updateLastFocusedWindow(windows: BrowserWindowCandidate[]): void {
  const focused = windows.find((window) => window.focused);
  if (focused) {
    lastFocusedWindowUid = focused.uid;
  } else if (!windows.some((window) => window.uid === lastFocusedWindowUid)) {
    lastFocusedWindowUid = windows[0]?.uid;
  }
}

function requestWindowPairing(windowUid: string): void {
  if (pairedWindowUids.has(windowUid)) {
    return;
  }
  if ([...pendingWindowPairings.values()].includes(windowUid)) {
    return;
  }
  const requestUid = crypto.randomUUID();
  pendingWindowPairings.set(requestUid, windowUid);
  extLog("Pairing", `Requesting pairing for window ${windowUid} (req=${requestUid})`);
  send({ type: "pairWindow", requestUid, windowUid });
}

function rebuildDesktopWindows(): Promise<{ ok: boolean; message: string }> {
  if (socket?.readyState !== WebSocket.OPEN) {
    return Promise.resolve({ ok: false, message: "Desktop is not connected" });
  }

  const requestUid = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingResyncs.delete(requestUid);
      resolve({ ok: false, message: "Resync timed out" });
    }, 5_000);
    pendingResyncs.set(requestUid, { resolve, timeout });
    send({ type: "resync", requestUid });
  });
}

async function loadInstance(label: string): Promise<BrowserInstance> {
  return { uid: await loadInstanceUid(), browser: browserKind(), label };
}

function send(message: ExtensionMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function startHeartbeat(): void {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
}

function reconnect(): void {
  clearInterval(heartbeatTimer);
  pairedWindowUids.clear();
  pendingWindowPairings.clear();
  if (!connectionEnabled) {
    connectionStateMachine.transition("disabled", "Widget disabled in settings");
    return;
  }

  reconnectAttempts += 1;
  if (reconnectAttempts >= 3) {
    connectionStateMachine.transition(
      "disconnected",
      "Desktop widget is offline. Click Reconnect when BrowseRail desktop is running.",
    );
    clearTimeout(reconnectTimer);
    return;
  }

  connectionStateMachine.transition(
    "reconnecting",
    `Retry attempt ${reconnectAttempts}/3 in 3s…`,
  );
  reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
}

function manualReconnect(): void {
  reconnectAttempts = 0;
  clearTimeout(reconnectTimer);
  clearInterval(heartbeatTimer);
  const currentSocket = socket;
  socket = undefined;
  currentSocket?.close();
  connectionStateMachine.transition("connecting", `Manual reconnect initiated`);
  void connect();
}

function stopConnection(): void {
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  pairedWindowUids.clear();
  pendingWindowPairings.clear();
  const currentSocket = socket;
  socket = undefined;
  if (currentSocket) {
    try {
      currentSocket.close(1000, "Disabled");
    } catch {
      // Ignore
    }
  }
  if (connectionEnabled) {
    connectionStateMachine.transition("disconnected", "Connection stopped");
  } else {
    connectionStateMachine.transition("disabled", "Connection disabled");
  }
}

function isConfigSavedMessage(value: unknown): value is { type: "configSaved" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "configSaved";
}

function isGetStateMessage(value: unknown): value is { type: "getDesktopState" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "getDesktopState";
}

function isManualReconnectMessage(value: unknown): value is { type: "manualReconnect" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "manualReconnect";
}

function isResyncWindowsMessage(value: unknown): value is { type: "resyncWindows" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "resyncWindows";
}

function isResetMenuLayoutMessage(
  value: unknown,
): value is { type: "resetMenuLayout"; menuUid: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "resetMenuLayout" &&
    "menuUid" in value &&
    typeof (value as { menuUid?: unknown }).menuUid === "string"
  );
}

function isSetWidgetEnabledMessage(
  value: unknown,
): value is { type: "setWidgetEnabled"; enabled: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "setWidgetEnabled" &&
    "enabled" in value &&
    typeof (value as { enabled: unknown }).enabled === "boolean"
  );
}

browser.commands.onCommand.addListener(async (command) => {
  const currentWindow = await browser.windows.getCurrent();
  if (!currentWindow?.id) return;
  const windowId = currentWindow.id;
  const config = await loadConfig();

  const target = config.shortcuts.find((s) => s.slot === command);
  if (!target) return;

  const tabMode = target.tabMode || "replace";

  if (target.type === "dynamic" && target.dynamicUid) {
    const live = (await loadDynamicValues())[target.dynamicUid];
    if (live?.url) {
      await navigateToUrl(browser, windowId, live.url, tabMode);
    }
    return;
  }

  if (target.path) {
    const rootPrefix = await loadBookmarkRootPrefix();
    const effectivePath = combineRootAndItemPath(rootPrefix, target.path);
    const tree = (await browser.bookmarks.getTree()) as BookmarkNode[];
    const node = findBookmarkNodeByPath(tree, effectivePath, target.url);
    if (node?.url) {
      await navigateToUrl(browser, windowId, node.url, tabMode);
    }
  } else if (target.url) {
    await navigateToUrl(browser, windowId, target.url, tabMode);
  }
});

async function executeNativeShortcut(shortcutId: string, targetWindowUid?: string): Promise<void> {
  const config = await loadConfig();
  const target = config.nativeShortcuts?.find((s) => s.id === shortcutId);
  if (!target) return;
  const targetWindow = targetWindowUid ?? lastFocusedWindowUid ?? (await browser.windows.getLastFocused())?.id;
  if (!targetWindow) return;
  const tabMode = target.tabMode || "replace";
  if (target.type === "dynamic" && target.dynamicUid) {
    const live = (await loadDynamicValues())[target.dynamicUid];
    if (live?.url) {
      await navigateToUrl(browser, targetWindow, live.url, tabMode);
    }
    return;
  }
  if (target.path) {
    const rootPrefix = await loadBookmarkRootPrefix();
    const effectivePath = combineRootAndItemPath(rootPrefix, target.path);
    const tree = (await browser.bookmarks.getTree()) as BookmarkNode[];
    const node = findBookmarkNodeByPath(tree, effectivePath, target.url);
    if (node?.url) {
      await navigateToUrl(browser, targetWindow, node.url, tabMode);
    }
  } else if (target.url) {
    await navigateToUrl(browser, targetWindow, target.url, tabMode);
  }
}
