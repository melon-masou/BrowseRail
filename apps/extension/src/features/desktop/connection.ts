import browser from "webextension-polyfill";
import { isNativeMessage, PROTOCOL_VERSION, type BrowserInstance, type ExtensionMessage } from "@browserail/protocol";
import { saveBarLayout } from "../../lib/config";
import { loadInstanceUid } from "../../lib/config/instance-identity";
import { browserKind } from "../../lib/browser/windows";
import { ExtensionStateMachine } from "./state-machine";
import type { DebugLog } from "./debug-log";
import type { WindowFocus } from "./focus";

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 3_000;

export interface DesktopConnectionHost {
  log: DebugLog;
  focus: WindowFocus;
  requestSync(): Promise<void>;
  /** Native editing state reported by the desktop. */
  editingChanged(editing: boolean): Promise<void>;
  /** Runs a button or shortcut the desktop invoked; a thrown error is reported back to the desktop. */
  invoke(actionUid: string, menuUid: string | undefined, windowUid: string): Promise<void>;
}

/** The WebSocket session with the desktop app: handshake, heartbeat, reconnects and window pairing. */
export function createDesktopConnection(host: DesktopConnectionHost) {
  const { log, focus } = host;
  const state = new ExtensionStateMachine("disconnected");
  let socket: WebSocket | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let generation = 0;
  let enabled = false;
  let desiredInstanceLabel = "";
  let desiredSocketUrl = "";
  const pairedWindowUids = new Set<string>();
  const pendingWindowPairings = new Map<string, string>();
  const pendingResyncs = new Map<string, { resolve: (result: { ok: boolean; message: string }) => void; timeout: ReturnType<typeof setTimeout> }>();

  log.forwardTo(entry => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "clientDebugLog", ...entry }));
      } catch {
        // ignore
      }
    }
  });

  function isOpen(): boolean {
    return socket?.readyState === WebSocket.OPEN;
  }

  function send(message: ExtensionMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async function loadInstance(label: string): Promise<BrowserInstance> {
    return { uid: await loadInstanceUid(), browser: browserKind(), label };
  }

  function startHeartbeat(): void {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_INTERVAL_MS);
  }

  async function connect(current = generation): Promise<void> {
    clearTimeout(reconnectTimer);
    const instance = await loadInstance(desiredInstanceLabel);
    if (!enabled || current !== generation) {
      return;
    }
    state.transition("connecting", `Connecting to ${desiredSocketUrl}`);
    log.log("Connect", `Connecting to ${desiredSocketUrl} (gen ${current})`);
    let nextSocket: WebSocket;
    try {
      nextSocket = new WebSocket(desiredSocketUrl);
    } catch (err) {
      log.log("Connect", `WebSocket constructor threw error: ${String(err)}`);
      reconnect();
      return;
    }
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      if (socket !== nextSocket) {
        return;
      }
      state.transition("handshaking", `WebSocket opened, sending hello (instance: ${instance.uid})`);
      log.log("Connect", `WebSocket opened, sending hello (instance: ${instance.uid}, browser: ${instance.browser})`);
      send({ type: "hello", protocolVersion: PROTOCOL_VERSION, instance });
      startHeartbeat();
    });
    nextSocket.addEventListener("message", (event) => {
      if (socket === nextSocket) {
        void handleMessage(event.data);
      }
    });
    nextSocket.addEventListener("close", () => {
      if (socket === nextSocket) {
        log.log("Connect", "WebSocket closed");
        socket = undefined;
        reconnect();
      }
    });
    nextSocket.addEventListener("error", () => {
      log.log("Connect", "WebSocket connection error");
    });
  }

  function reconnect(): void {
    clearInterval(heartbeatTimer);
    pairedWindowUids.clear();
    pendingWindowPairings.clear();
    if (!enabled) {
      state.transition("disabled", "Widget disabled in settings");
      return;
    }

    reconnectAttempts += 1;
    if (reconnectAttempts >= 3) {
      state.transition("disconnected", "Desktop widget is offline. Click Reconnect when BrowseRail desktop is running.");
      clearTimeout(reconnectTimer);
      return;
    }

    state.transition("reconnecting", `Retry attempt ${reconnectAttempts}/3 in 3s…`);
    reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
  }

  function stop(): void {
    clearInterval(heartbeatTimer);
    clearTimeout(reconnectTimer);
    pairedWindowUids.clear();
    pendingWindowPairings.clear();
    const currentSocket = socket;
    socket = undefined;
    if (currentSocket) {
      try {
        if (currentSocket.readyState === WebSocket.OPEN) {
          currentSocket.send(JSON.stringify({ type: "detach" } satisfies ExtensionMessage));
        }
      } catch (error) {
        console.error("Failed to notify desktop of detach", error);
      } finally {
        try {
          currentSocket.close(1000, "Disabled");
        } catch {
          // The socket may already have closed.
        }
      }
    }
    if (enabled) {
      state.transition("disconnected", "Connection stopped");
    } else {
      state.transition("disabled", "Connection disabled");
    }
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
      state.transition("connected", `Handshake completed, protocol v${value.protocolVersion}`);
      log.log("Protocol", `Handshake completed, protocol v${value.protocolVersion}`);
      void host.requestSync();
      return;
    }

    if (value.type === "editingState") {
      await host.editingChanged(value.editing);
      return;
    }

    if (value.type === "resyncComplete") {
      const pending = pendingResyncs.get(value.requestUid);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingResyncs.delete(value.requestUid);
        pairedWindowUids.clear();
        pendingWindowPairings.clear();
        void host.requestSync();
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
      const targetWindowUid = value.windowUid ?? focus.get();
      if (!targetWindowUid) {
        return;
      }
      let error: string | undefined;
      try {
        await host.invoke(value.actionUid, value.menuUid, targetWindowUid);
      } catch (cause) {
        error = String(cause);
        void host.requestSync();
      }
      if (value.menuUid) send({
        type: "actionResult", menuUid: value.menuUid, windowUid: value.windowUid ?? null,
        actionUid: value.actionUid, ...(error !== undefined ? { error } : {}),
      });
      return;
    }

    if (value.type === "verifyWindowPairing") {
      const pendingWindowUid = pendingWindowPairings.get(value.requestUid);
      log.log("Pairing", `verifyWindowPairing received: req=${value.requestUid}, win=${value.windowUid}, expected=${pendingWindowUid}`);
      if (pendingWindowUid !== value.windowUid) {
        log.log("Pairing", "verifyWindowPairing ignored: pending mismatch");
        return;
      }
      try {
        const window = await browser.windows.get(Number(value.windowUid));
        log.log("Pairing", `browser.windows.get(${value.windowUid}) result: focused=${window.focused}, state=${window.state}, type=${window.type}`);
        if (window.focused === true) {
          log.log("Pairing", `confirming window pairing for req=${value.requestUid}, win=${value.windowUid}`);
          send({ type: "confirmWindowPairing", requestUid: value.requestUid, windowUid: value.windowUid });
        } else {
          log.log("Pairing", `NOT confirming pairing: window.focused is not true (it is ${window.focused})`);
        }
      } catch (err) {
        log.log("Pairing", `browser.windows.get(${value.windowUid}) threw error`, err);
        pendingWindowPairings.delete(value.requestUid);
      }
      return;
    }

    if (value.type === "pairWindowResult") {
      const pendingWindowUid = pendingWindowPairings.get(value.requestUid);
      pendingWindowPairings.delete(value.requestUid);
      log.log("Pairing", `pairWindowResult: req=${value.requestUid}, win=${value.windowUid}, ok=${value.ok}, pendingUid=${pendingWindowUid}`);
      if (value.ok && pendingWindowUid === value.windowUid) {
        pairedWindowUids.add(value.windowUid);
        log.log("Pairing", `Successfully paired window ${value.windowUid}. Total paired: ${pairedWindowUids.size}`);
      } else {
        log.log("Pairing", `Pairing failed or mismatch for window ${value.windowUid}`);
      }
      return;
    }

    if (value.type === "updateMenuLayout") {
      await saveBarLayout(value.menuUid, "native", value.placement, value.spacing, value.settings);
      void host.requestSync();
    }
  }

  return {
    state,
    isOpen,
    send,
    /** Opens, keeps or closes the session for the current settings; `force` reconnects even when unchanged. */
    async reconcile(next: { enabled: boolean; url: string; label: string; force?: boolean }): Promise<void> {
      const current = ++generation;
      enabled = next.enabled;
      const connectionMatches =
        desiredSocketUrl === next.url &&
        desiredInstanceLabel === next.label &&
        socket !== undefined &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN);
      desiredSocketUrl = next.url;
      desiredInstanceLabel = next.label;
      if (!enabled) {
        stop();
      } else if (!connectionMatches || next.force) {
        stop();
        reconnectAttempts = 0;
        state.transition("disconnected", "Connection parameters changed");
        await connect(current);
      }
    },
    /** Asks the desktop to pair a window; skipped while that window is paired or a request is pending. */
    requestWindowPairing(windowUid: string): void {
      if (pairedWindowUids.has(windowUid)) {
        return;
      }
      if ([...pendingWindowPairings.values()].includes(windowUid)) {
        return;
      }
      const requestUid = crypto.randomUUID();
      pendingWindowPairings.set(requestUid, windowUid);
      log.log("Pairing", `Requesting pairing for window ${windowUid} (req=${requestUid})`);
      send({ type: "pairWindow", requestUid, windowUid });
    },
    forgetWindow(windowUid: string): void {
      pairedWindowUids.delete(windowUid);
      for (const [requestUid, pendingWindowUid] of pendingWindowPairings) {
        if (pendingWindowUid === windowUid) {
          pendingWindowPairings.delete(requestUid);
        }
      }
    },
    rebuildWindows(): Promise<{ ok: boolean; message: string }> {
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
    },
    debugInfo() {
      return {
        connected: socket?.readyState === WebSocket.OPEN,
        socketUrl: desiredSocketUrl,
        instanceLabel: desiredInstanceLabel,
        pairedWindowUids: Array.from(pairedWindowUids),
        pendingWindowPairings: Array.from(pendingWindowPairings.entries()).map(([requestUid, windowUid]) => ({ requestUid, windowUid })),
      };
    },
  };
}
export type DesktopConnection = ReturnType<typeof createDesktopConnection>;
