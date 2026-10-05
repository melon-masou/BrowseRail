// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createTauriPopupLink } from "./tauri-popup";
import type { PopupRequest } from "@browserail/menu-ui";

const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    events.set(name, callback); return () => events.delete(name);
  }),
}));
const links: Array<{ destroy(): void }> = [];
beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "surface_work_area") return { left: 0, top: 0, right: 1200, bottom: 600 };
    return undefined;
  });
});
afterEach(() => { for (const link of links.splice(0)) link.destroy(); events.clear(); vi.resetAllMocks(); document.body.replaceChildren(); });

it("waits for the current popup's render acknowledgement before returning its session", async () => {
  const root = document.createElement("div"); document.body.append(root);
  const link = await createTauriPopupLink(root, { instanceUid: "instance", menuUid: "menu", windowUid: "42", isFree: false, parentLabel: "menu-42" });
  links.push(link);
  let requestUid = "";
  let openingSent!: () => void;
  const sent = new Promise<void>(resolve => { openingSent = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "surface_work_area") return { left: 0, top: 0, right: 1200, bottom: 600 };
    if (command === "open_popup") {
      requestUid = (args as { request: { requestUid: string } }).request.requestUid;
      openingSent();
    }
    return undefined;
  });
  const request: PopupRequest = {
    folder: { kind: "folder", uid: "folder", label: "Folder", children: [{ kind: "bookmark", uid: "child", label: "Child" }] },
    anchor: { left: 0, right: 84, top: 0, bottom: 36 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction: "down", editingLocked: true, pin: "none",
  };
  let returned = false;
  const opened = link.open(request).then(session => { returned = true; return session; });
  await sent;
  events.get("popup-ready")!({ payload: { requestUid: "another-popup" } });
  await Promise.resolve(); expect(returned).toBe(false);
  events.get("popup-ready")!({ payload: { requestUid } });
  const session = await opened;
  let closed = false; void session.closed.then(() => { closed = true; });
  events.get("popup-closed")!({ payload: "another-menu" });
  await Promise.resolve(); expect(closed).toBe(false);
  events.get("popup-closed")!({ payload: "menu" });
  await session.closed;
  expect(closed).toBe(true);
});


function popupRequest(direction: "down" | "right" = "down"): PopupRequest {
  return {
    folder: { kind: "folder", uid: "folder", label: "Folder", children: [{ kind: "bookmark", uid: "child", label: "Child" }] },
    anchor: { left: 0, right: 84, top: 0, bottom: 36 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction, editingLocked: true, pin: "none",
  };
}
async function popupLink() {
  const root = document.createElement("div"); document.body.append(root);
  const link = await createTauriPopupLink(root, { instanceUid: "instance", menuUid: "menu", windowUid: "42", isFree: false, parentLabel: "menu-42" });
  links.push(link); return link;
}

it.each(["down", "right"] as const)("cancels opening when destroyed during the work-area query (%s)", async direction => {
  const link = await popupLink();
  let queried!: () => void; const started = new Promise<void>(resolve => { queried = resolve; });
  let finishQuery!: () => void;
  const pendingQuery = new Promise<unknown>(resolve => { finishQuery = () => resolve({ left: 0, top: 0, right: 1200, bottom: 600 }); });
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === "surface_work_area") { queried(); return pendingQuery; }
    return undefined;
  });
  const opened = link.open(popupRequest(direction));
  const rejected = expect(opened).rejects.toThrow("destroyed");
  await started; link.destroy(); await rejected;
  finishQuery(); await Promise.resolve(); await Promise.resolve();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "open_popup")).toBe(false);
});

it("rejects a native opening failure and waits for its popup to close", async () => {
  const link = await popupLink();
  let requestUid = ""; let openingSent!: () => void;
  const sent = new Promise<void>(resolve => { openingSent = resolve; });
  let closingSent!: () => void; const closing = new Promise<void>(resolve => { closingSent = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "surface_work_area") return { left: 0, top: 0, right: 1200, bottom: 600 };
    if (command === "open_popup") {
      requestUid = (args as { request: { requestUid: string } }).request.requestUid; openingSent();
    }
    if (command === "close_popup") closingSent();
    return undefined;
  });
  const opened = link.open(popupRequest());
  const rejected = expect(opened).rejects.toThrow("Popup window is unavailable");
  await sent;
  events.get("popup-ready")!({ payload: { requestUid, error: "Popup window is unavailable" } });
  await closing;
  events.get("popup-closed")!({ payload: "menu" });
  await rejected;
});

it("does not finish session.close before the native close notification", async () => {
  const link = await popupLink();
  let requestUid = ""; let openingSent!: () => void;
  const sent = new Promise<void>(resolve => { openingSent = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "surface_work_area") return { left: 0, top: 0, right: 1200, bottom: 600 };
    if (command === "open_popup") {
      requestUid = (args as { request: { requestUid: string } }).request.requestUid; openingSent();
    }
    return undefined;
  });
  const opened = link.open(popupRequest()); await sent;
  events.get("popup-ready")!({ payload: { requestUid } });
  const session = await opened;
  let done = false; const closed = session.close().then(() => { done = true; });
  await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "close_popup")).toBe(true));
  expect(done).toBe(false);
  events.get("popup-closed")!({ payload: "menu" });
  await closed; expect(done).toBe(true);
});
