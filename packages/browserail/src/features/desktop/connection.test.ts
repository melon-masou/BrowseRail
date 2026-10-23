import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerRuntimeAdapter, type RuntimeAdapter, type RuntimeHost } from "@browserail/runtime-adapter";
import { PROTOCOL_VERSION } from "@browserail/protocol";
import { createDesktopConnection } from "./connection";
import { createDebugLog } from "./debug-log";
import { createWindowFocus } from "./focus";

const sockets: TestSocket[] = [];
class TestSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = TestSocket.CONNECTING;
  messages: Record<string, unknown>[] = [];
  constructor() { super(); sockets.push(this); }
  open(): void { this.readyState = TestSocket.OPEN; this.dispatchEvent(new Event("open")); }
  send(data: string): void { this.messages.push(JSON.parse(data) as Record<string, unknown>); }
  receive(data: unknown): void { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
  close(): void { this.readyState = 3; }
}

beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; vi.stubGlobal("WebSocket", TestSocket); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["focused", "unfocused", "removed"])("verifies native window pairing against the runtime's %s window", async status => {
  const unsupported = (): never => { throw new Error("Operation not used by desktop connection"); };
  const area = { get: async () => ({ instanceUid: "instance" }), set: async () => {}, remove: async () => {} };
  const runtime: RuntimeAdapter = {
    storage: { local: area, session: area, sync: undefined, onChanged: { addListener() {}, removeListener() {} } },
    bookmarks: { isAvailable: async () => false, getTree: unsupported, get: unsupported, create: unsupported },
    navigation: { get: unsupported, query: unsupported, create: unsupported, update: unsupported, goBack: unsupported, goForward: unsupported, reload: unsupported },
    messaging: { id: "test", send: unsupported, sendToTab: unsupported, sendToExtension: unsupported, onMessage: { addListener() {}, removeListener() {} } },
    permissions: { getAll: unsupported, contains: unsupported, request: unsupported, remove: unsupported },
    capabilities: { browserBookmarks: false, browserSync: false, websitePermissions: false, browserShortcuts: false, externalExtensions: false, desktopConnection: true },
    resourceUrl: unsupported, resourceJson: unsupported, platformInfo: async () => ({ os: "linux" }),
  };
  const host: RuntimeHost = {
    browserKind: () => "test",
    listWindows: async () => status === "removed" ? [] : [{ uid: "7", focused: status === "focused", bounds: { x: 0, y: 0, width: 800, height: 600 } }],
    commands: unsupported, openShortcutSettings: unsupported,
    onPermissionsChanged: () => () => {}, onTabRemoved: () => () => {}, onTabUpdated: () => () => {},
    openConfirmation: unsupported, runRewrite: unsupported,
  };
  registerRuntimeAdapter(runtime, host);
  const connection = createDesktopConnection({
    log: createDebugLog(), focus: createWindowFocus(), requestSync: async () => {},
    editingChanged: async () => {}, invoke: async () => {},
  });
  try {
    await connection.reconcile({ enabled: true, url: "ws://127.0.0.1:17654", label: "Desktop test" });
    const socket = sockets[0]!;
    socket.open();
    expect(socket.messages[0]).toMatchObject({ type: "hello", protocolVersion: PROTOCOL_VERSION, instance: { uid: "instance", label: "Desktop test" } });
    socket.receive({ type: "ready", protocolVersion: PROTOCOL_VERSION });
    expect(connection.state.getState()).toBe("connected");
    connection.requestWindowPairing("7");
    const request = socket.messages.find(message => message.type === "pairWindow")!;
    socket.receive({ type: "verifyWindowPairing", requestUid: "unrelated", windowUid: "7" });
    socket.receive({ type: "verifyWindowPairing", requestUid: request.requestUid, windowUid: "7" });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.messages.filter(message => message.type === "confirmWindowPairing")).toEqual(status === "focused"
      ? [{ type: "confirmWindowPairing", requestUid: request.requestUid, windowUid: "7" }] : []);
  } finally {
    await connection.reconcile({ enabled: false, url: "ws://127.0.0.1:17654", label: "Desktop test" });
  }
});
