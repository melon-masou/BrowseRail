import {
  isServerMessage,
  PROTOCOL_VERSION,
  type BrowserInstance,
  type BrowserWindowSnapshot,
  type ClientMessage,
  type PanelSnapshot,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import { resolveMenuItems } from "../bookmarks";
import { browserKind, listBrowserWindows } from "../browser-adapter";
import {
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
  let text = "";
  let color = "#757575";
  let title = `BrowseRail: ${state}`;
  switch (state) {
    case "connected":
      text = "ON";
      color = "#2e7d32";
      title = `BrowseRail: Connected (${detail ?? "Ready"})`;
      break;
    case "syncing":
      text = "SYNC";
      color = "#1565c0";
      title = `BrowseRail: Syncing (${detail ?? ""})`;
      break;
    case "connecting":
    case "handshaking":
      text = "…";
      color = "#f57c00";
      title = "BrowseRail: Connecting…";
      break;
    case "reconnecting":
      text = "WAIT";
      color = "#e65100";
      title = `BrowseRail: Reconnecting (${detail ?? ""})`;
      break;
    case "disconnected":
      text = "OFF";
      color = "#757575";
      title = "BrowseRail: Disconnected";
      break;
    case "disabled":
      text = "";
      title = "BrowseRail: Disabled";
      break;
  }
  void browser.action.setBadgeText({ text });
  void browser.action.setBadgeBackgroundColor({ color });
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
let lastFocusedWindowUid: string | undefined;
let syncRequested = false;
let syncRunning = false;
let connectionGeneration = 0;
let connectionEnabled = false;
let desiredInstanceLabel = "";
let desiredSocketUrl = "";
let focusLostTimer: ReturnType<typeof setTimeout> | undefined;
const pendingResyncs = new Map<
  string,
  {
    resolve: (result: { ok: boolean; message: string }) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

void reconcileConnection();

browser.windows
  .getLastFocused()
  .then((w) => {
    if (w && w.id !== undefined && (w.type === "normal" || w.type === undefined)) {
      lastFocusedWindowUid = String(w.id);
      requestSync();
    }
  })
  .catch(() => {});

browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId >= 0) {
    clearTimeout(focusLostTimer);
    lastFocusedWindowUid = String(windowId);
    requestSync();
  } else {
    clearTimeout(focusLostTimer);
    focusLostTimer = setTimeout(() => {
      requestSync();
    }, 120);
  }
});
browser.windows.onCreated.addListener(requestSync);
browser.windows.onRemoved.addListener(requestSync);
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

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.config || changes.widget_enabled)) {
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
  if (isManualReconnectMessage(message)) {
    manualReconnect();
    return Promise.resolve({ ok: true });
  }
  if (isResyncWindowsMessage(message)) {
    return rebuildDesktopWindows();
  }
  if (isConfigSavedMessage(message)) {
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
  const [instance, lastFocused] = await Promise.all([
    loadInstance(desiredInstanceLabel),
    browser.windows.getLastFocused().catch(() => undefined),
  ]);
  if (!connectionEnabled || generation !== connectionGeneration) {
    return;
  }
  if (lastFocused?.id !== undefined) {
    lastFocusedWindowUid = String(lastFocused.id);
  }
  connectionStateMachine.transition("connecting", `Connecting to ${desiredSocketUrl}`);
  const nextSocket = new WebSocket(desiredSocketUrl);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) {
      return;
    }
    connectionStateMachine.transition("handshaking", `WebSocket opened, sending hello (instance: ${instance.uid})`);
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
      socket = undefined;
      reconnect();
    }
  });
  nextSocket.addEventListener("error", () => nextSocket.close());
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
    requestSync();
    return;
  }

  if (value.type === "resyncComplete") {
    const pending = pendingResyncs.get(value.requestUid);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingResyncs.delete(value.requestUid);
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

  const [config, windows, placements] = await Promise.all([
    loadConfig(),
    listBrowserWindows(),
    loadMenuPlacements(),
  ]);
  const menus = await Promise.all(
    config.panel.menus.map(async (menu, index) => {
      const items = await resolveMenuItems(menu.items);
      const placement = resolveMenuPlacement(
        placements[menu.uid],
        index,
        menu.orientation,
        items.length,
        menu.fontSize,
      );
      return {
        fontSize: menu.fontSize ?? "medium",
        items,
        orientation: menu.orientation,
        placement,
        uid: menu.uid,
      };
    }),
  );
  updateLastFocusedWindow(windows);

  const selected = selectWindows(config.attachmentMode, windows);
  const panels: PanelSnapshot[] = selected.map((window) => ({
    alwaysOnTop: config.panel.alwaysOnTop,
    menus,
    window,
  }));

  send({
    type: "sync",
    revision: ++revision,
    attachmentMode: config.attachmentMode,
    panels,
  });
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

function selectWindows(
  mode: Awaited<ReturnType<typeof loadConfig>>["attachmentMode"],
  windows: BrowserWindowSnapshot[],
): BrowserWindowSnapshot[] {
  switch (mode) {
    case "none":
      return [];
    case "all":
      return windows;
    case "lastFocused":
      return windows.filter((window) => window.uid === lastFocusedWindowUid);
  }
}

function updateLastFocusedWindow(windows: BrowserWindowSnapshot[]): void {
  const focused = windows.find((window) => window.focused);
  if (focused) {
    lastFocusedWindowUid = focused.uid;
  } else if (!windows.some((window) => window.uid === lastFocusedWindowUid)) {
    lastFocusedWindowUid = windows[0]?.uid;
  }
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
  if (!connectionEnabled) {
    connectionStateMachine.transition("disabled", "Widget disabled in settings");
    return;
  }

  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    connectionStateMachine.transition(
      "disconnected",
      `Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts. Click Reconnect to retry.`,
    );
    return;
  }

  connectionStateMachine.transition(
    "reconnecting",
    `Retry attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in 3s…`,
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
