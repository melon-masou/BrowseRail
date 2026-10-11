// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { Runtime } from "webextension-polyfill";
import type { BrowserMenu, BrowserMenuState, MenuReply } from "@browserail/protocol/content";

const mock = vi.hoisted(() => ({
  send: vi.fn<(message: unknown) => Promise<BrowserMenuState | MenuReply>>(),
  connect: vi.fn(),
  receive: undefined as ((message: unknown, sender: Runtime.MessageSender) => unknown) | undefined,
}));
vi.mock("webextension-polyfill", () => ({ default: { runtime: {
  id: "browserail", sendMessage: mock.send, connect: mock.connect,
  onMessage: { addListener: (listener: (message: unknown, sender: Runtime.MessageSender) => unknown) => { mock.receive = listener; } },
} } }));

const menu: BrowserMenu = {
  view: { uid: "menu", orientation: "row", items: [
    { kind: "bookmark", uid: "static:fixed", label: "Fixed" }, { kind: "menuFold", uid: "fold", label: "Fold" },
  ] },
  placement: { anchor: "topLeft", offsetX: 0, offsetY: 0, itemWidth: 84, itemHeight: 36 },
  collapsed: false, editingLocked: true,
};
const snapshot: BrowserMenuState = { type: "state", menus: [menu] };
let listeners: MockInstance<typeof window.addEventListener>;
let shadows: MockInstance<typeof Element.prototype.attachShadow>;
let cssZoomDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("__browserailMenus", undefined);
  mock.send.mockReset().mockResolvedValue(snapshot); mock.connect.mockClear();
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: async () => [] } });
  listeners = vi.spyOn(window, "addEventListener"); shadows = vi.spyOn(Element.prototype, "attachShadow");
  cssZoomDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "currentCSSZoom");
  // happy-dom does not implement the browser's cumulative CSS zoom calculation.
  Object.defineProperty(Element.prototype, "currentCSSZoom", { configurable: true, get(this: Element) {
    let zoom = Number.parseFloat(window.getComputedStyle(this).zoom) || 1;
    for (let parent = this.parentElement; parent; parent = parent.parentElement) {
      zoom *= Number.parseFloat(window.getComputedStyle(parent).zoom) || 1;
    }
    return zoom;
  } });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  for (const [type, listener, options] of listeners.mock.calls) {
    if (type === "pagehide" || type === "pageshow" || type === "resize") window.removeEventListener(type, listener, options);
  }
  if (cssZoomDescriptor) Object.defineProperty(Element.prototype, "currentCSSZoom", cssZoomDescriptor);
  else Reflect.deleteProperty(Element.prototype, "currentCSSZoom");
  document.body.style.removeProperty("zoom"); document.documentElement.style.removeProperty("zoom");
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren();
});

async function mount() {
  await import("./entry");
  await vi.advanceTimersByTimeAsync(60);
  const host = document.querySelector("browserail-menus");
  const shadow: unknown = shadows.mock.results[0]?.value;
  expect(host).not.toBeNull();
  if (!(shadow instanceof ShadowRoot)) throw new Error("Menu shadow is missing");
  return { host, shadow };
}

it("keeps the bar at its own CSS size when page zoom changes after mounting without a resize", async () => {
  document.body.style.zoom = "0.5";
  const { host } = await mount();
  expect(host!.currentCSSZoom).toBeCloseTo(1);
  mock.send.mockClear();
  const changes: [string, string][] = [["1", "1"], ["1.5", "0.5"], ["0.5", "2"], ["1", "1"]];
  for (const [htmlZoom, bodyZoom] of changes) {
    document.documentElement.style.zoom = htmlZoom; document.body.style.zoom = bodyZoom;
    await vi.advanceTimersByTimeAsync(20);
    expect(host!.currentCSSZoom).toBeCloseTo(1);
  }
  expect(mock.send).not.toHaveBeenCalled();
});

it("preserves page zoom compensation when a page is restored or its menus return", async () => {
  document.body.style.zoom = "0.5";
  await mount();
  window.dispatchEvent(new Event("pagehide"));
  document.body.style.zoom = "2";
  window.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(60);
  expect(document.querySelector("browserail-menus")!.currentCSSZoom).toBeCloseTo(1);
  mock.send.mockResolvedValue({ type: "state", menus: [] });
  await mock.receive!({ type: "browserMenusRefresh" }, { id: "browserail" });
  document.body.style.zoom = "0.75";
  mock.send.mockResolvedValue(snapshot);
  const refresh = mock.receive!({ type: "browserMenusRefresh" }, { id: "browserail" });
  await vi.advanceTimersByTimeAsync(60); await refresh;
  expect(document.querySelector("browserail-menus")!.currentCSSZoom).toBeCloseTo(1);
});

it("keeps bars and buttons mounted while idle without communicating with the background", async () => {
  const { host, shadow } = await mount();
  const button = shadow.querySelector("button");
  mock.send.mockClear();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.connect).not.toHaveBeenCalled();
  expect(document.querySelector("browserail-menus")).toBe(host);
  expect(shadow.querySelector("button")).toBe(button);
  // Re-executing the registered file must not refresh an already rendered document.
  vi.resetModules(); await import("./entry");
  expect(mock.send).not.toHaveBeenCalled();
  expect(document.querySelector("browserail-menus")).toBe(host);
});

it("executes a fold click with one message and applies its returned state", async () => {
  const { shadow } = await mount();
  mock.send.mockClear().mockResolvedValue({ state: { type: "state", menus: [{ ...menu, collapsed: true }] } });
  const fold = Array.from(shadow.querySelectorAll("button")).find(button => button.textContent === "Fold")!;
  fold.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  await vi.advanceTimersByTimeAsync(60);
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.send).toHaveBeenCalledWith({ type: "browserMenuCommand", command: { type: "fold", menuUid: "menu" } });
  expect(shadow.querySelectorAll(".menu-button")).toHaveLength(1);
  expect(mock.connect).not.toHaveBeenCalled();
});

/* Enable together with mount recovery.
it("restores the existing bars after page rendering removes them, without reading new state", async () => {
  const { host, shadow } = await mount();
  const button = shadow.querySelector("button");
  mock.send.mockClear();
  document.body.replaceChildren();
  await vi.advanceTimersByTimeAsync(60);
  expect(document.body.querySelector("browserail-menus")).toBe(host);
  expect(shadow.querySelector("button")).toBe(button);
  const replacement = document.createElement("body");
  document.body.replaceWith(replacement);
  await vi.advanceTimersByTimeAsync(60);
  expect(replacement.querySelector("browserail-menus")).toBe(host);
  expect(shadow.querySelector("button")).toBe(button);
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.connect).not.toHaveBeenCalled();
  mock.send.mockResolvedValue({ state: { type: "state", menus: [{ ...menu, collapsed: true }] } });
  const fold = Array.from(shadow.querySelectorAll("button")).find(button => button.textContent === "Fold")!;
  fold.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  await vi.advanceTimersByTimeAsync(60);
  expect(mock.send).toHaveBeenCalledOnce();
  expect(shadow.querySelectorAll(".menu-button")).toHaveLength(1);
});
*/

it("does not create an overlay or keep checking when no menus are available", async () => {
  mock.send.mockResolvedValue({ type: "state", menus: [] });
  await import("./entry");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(document.querySelector("browserail-menus")).toBeNull();
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.connect).not.toHaveBeenCalled();
});

it("cleans up on pagehide, reads again on pageshow, and refreshes only for a trusted explicit operation", async () => {
  await mount();
  window.dispatchEvent(new Event("pagehide"));
  mock.send.mockClear();
  await vi.advanceTimersByTimeAsync(45_000);
  expect(mock.send).not.toHaveBeenCalled();
  expect(document.querySelector("browserail-menus")).toBeNull();
  window.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(60);
  expect(mock.send).toHaveBeenCalledOnce();
  expect(document.querySelector("browserail-menus")).not.toBeNull();
  mock.send.mockClear();
  mock.receive!({ type: "browserMenusRefresh" }, { id: "untrusted" });
  expect(mock.send).not.toHaveBeenCalled();
  mock.send.mockResolvedValue({ type: "state", menus: [] });
  const update = mock.receive!({ type: "browserMenusRefresh" }, { id: "browserail" });
  await vi.advanceTimersByTimeAsync(60); await update;
  expect(mock.send).toHaveBeenCalledOnce();
  expect(document.querySelector("browserail-menus")).toBeNull();
});
