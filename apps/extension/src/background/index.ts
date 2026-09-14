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
import { loadConfig, saveConfig } from "../config";
import { loadInstanceUid } from "../instance-identity";
import { navigateBookmark } from "../tab-actions/navigate";

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 2_000;

let socket: WebSocket | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let lastFocusedWindowUid: string | undefined;
let syncRequested = false;
let syncRunning = false;
let connectionGeneration = 0;
let connectionEnabled = false;
let desiredInstanceLabel = "";
let desiredSocketUrl = "";

void reconcileConnection();

browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId >= 0) {
    lastFocusedWindowUid = String(windowId);
  }
  requestSync();
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
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.config) {
    void reconcileConnection();
  }
});
browser.runtime.onMessage.addListener((message: unknown) => {
  if (isConfigSavedMessage(message)) {
    void reconcileConnection();
  }
});
browser.action.onClicked.addListener(() => void browser.runtime.openOptionsPage());

async function reconcileConnection(): Promise<void> {
  const generation = ++connectionGeneration;
  const config = await loadConfig();
  if (generation !== connectionGeneration) {
    return;
  }

  connectionEnabled = config.desktopWidget.enabled;
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
  const nextSocket = new WebSocket(desiredSocketUrl);
  socket = nextSocket;

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) {
      return;
    }
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
    requestSync();
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
    const config = await loadConfig();
    const menu = config.panel.menus.find((candidate) => candidate.uid === value.menuUid);
    if (menu) {
      menu.placement = value.placement;
      await saveConfig(config);
    }
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

  const [config, windows] = await Promise.all([loadConfig(), listBrowserWindows()]);
  const menus = await Promise.all(
    config.panel.menus.map(async (menu) => ({
      items: await resolveMenuItems(menu.items),
      orientation: menu.orientation,
      placement: menu.placement,
      uid: menu.uid,
    })),
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

function selectWindows(
  mode: Awaited<ReturnType<typeof loadConfig>>["attachmentMode"],
  windows: BrowserWindowSnapshot[],
): BrowserWindowSnapshot[] {
  switch (mode) {
    case "none":
      return [];
    case "active":
      return windows.some((window) => window.focused)
        ? windows.filter((window) => window.focused)
        : windows.filter((window) => window.uid === lastFocusedWindowUid);
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
  if (connectionEnabled) {
    reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
  }
}

function stopConnection(): void {
  clearInterval(heartbeatTimer);
  clearTimeout(reconnectTimer);
  const currentSocket = socket;
  socket = undefined;
  currentSocket?.close();
}

function isConfigSavedMessage(value: unknown): value is { type: "configSaved" } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "configSaved";
}
