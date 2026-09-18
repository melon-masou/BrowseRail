import {
  isServerMessage,
  PROTOCOL_VERSION,
  type BrowserInstance,
  type ClientMessage,
  type PanelSnapshot,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import { resolveMenuItems } from "../bookmarks";
import { browserKind, listBrowserWindows, type BrowserWindowCandidate } from "../browser-adapter";
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_MENU_GAP,
  type ExtensionConfig,
  loadConfig,
  loadMenuPlacements,
  loadWidgetEnabled,
  resolveMenuPlacement,
  saveMenuPlacement,
  saveWidgetEnabled,
} from "../config";
import { loadInstanceUid } from "../instance-identity";
import { ExtensionStateMachine, type ExtensionConnectionState } from "../state-machine";
import { navigateBookmark } from "../tab-actions/navigate";

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
  let title = `BrowseRail: ${state}`;
  switch (state) {
    case "connected":
      title = `BrowseRail: Connected (${detail ?? "Ready"})`;
      break;
    case "syncing":
      title = `BrowseRail: Syncing (${detail ?? ""})`;
      break;
    case "connecting":
    case "handshaking":
      title = "BrowseRail: Connecting…";
      break;
    case "reconnecting":
      title = `BrowseRail: Reconnecting (${detail ?? ""})`;
      break;
    case "disconnected":
      title = "BrowseRail: Disconnected";
      break;
    case "disabled":
      title = "BrowseRail: Disabled";
      break;
  }
  void browser.action.setBadgeText({ text: "" });
  void browser.action.setTitle({ title });
}

updateActionBadge(connectionStateMachine.getState());

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;

let socket: WebSocket | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let revision = 0;
let syncRequested = false;
let syncRunning = false;
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
  if (isConfigSavedMessage(message)) {
    previewConfigOverride = null;
    scheduleReconcile();
  }
  if (isSetWidgetEnabledMessage(message)) {
    connectionEnabled = message.enabled;
    void saveWidgetEnabled(message.enabled);
    if (!connectionEnabled) {
      stopConnection();
    } else {
      scheduleReconcile();
    }
    return Promise.resolve({ ok: true });
  }
});
browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());

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

  if (!isServerMessage(value)) {
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
    try {
      await navigateBookmark(browser, value.windowUid, value.actionUid);
      send({ type: "actionResult", requestUid: value.requestUid, ok: true });
    } catch (error) {
      send({
        type: "actionResult",
        requestUid: value.requestUid,
        ok: false,
        message: error instanceof Error ? error.message : "Action failed",
      });
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

  const [loadedConfig, windows, placements] = await Promise.all([
    loadConfig(),
    listBrowserWindows(),
    loadMenuPlacements(),
  ]);
  const config = previewConfigOverride ?? loadedConfig;
  const menus = await Promise.all(
    config.panel.menus.map(async (menu, index) => {
      const items = await resolveMenuItems(menu.items, menu.tabMode, menu.color);
      const placement = resolveMenuPlacement(
        placements[menu.uid],
        index,
        menu.orientation,
        items.length,
        menu.fontSize,
        menu.gap,
      );
      return {
        fontSize: menu.fontSize ?? DEFAULT_FONT_SIZE,
        gap: placement.gap ?? 0,
        ...(menu.color ? { color: menu.color } : {}),
        items,
        orientation: menu.orientation,
        placement,
        uid: menu.uid,
      };
    }),
  );
  updateLastFocusedWindow(windows);

  const panels: PanelSnapshot[] = windows.map((window) => ({
    alwaysOnTop: config.panel.alwaysOnTop,
    menus,
    window: {
      uid: window.uid,
      bounds: window.bounds,
      focused: window.uid === lastFocusedWindowUid,
    },
  }));

  extLog(
    "Sync",
    `syncOnce: totalWindows=${windows.length}, menus=${menus.length}, attachmentMode=${config.attachmentMode}, lastFocused=${lastFocusedWindowUid}, rev=${revision + 1}`,
  );

  send({
    type: "sync",
    revision: ++revision,
    attachmentMode: config.attachmentMode,
    panels,
  });

  if (config.attachmentMode !== "none") {
    for (const panel of panels) {
      if (panel.window.focused || config.attachmentMode === "all") {
        requestWindowPairing(panel.window.uid);
      }
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

function send(message: ClientMessage): void {
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
