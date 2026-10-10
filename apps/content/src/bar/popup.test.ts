// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { openBrowserPopup } from "./popup";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("keeps a pinned popup on inside clicks and closes on an outside click without consuming that click", async () => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: async () => [] } });
  const host = document.createElement("div"); document.body.append(host);
  const shadow = host.attachShadow({ mode: "closed" });
  const container = document.createElement("div"); shadow.append(container);
  const bar = document.createElement("div"); container.append(bar);
  const actions = { invokeAction: vi.fn(async () => {}), requestTemporarySave: vi.fn(async () => {}), requestToggleFold: vi.fn(async () => {}) };
  const session = await openBrowserPopup(container, bar, "topLeft", {
    folder: { kind: "folder", uid: "folder", label: "Folder", children: [{ kind: "bookmark", uid: "child", label: "Child" }] },
    anchor: { left: 0, top: 0, right: 84, bottom: 36 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction: "down", editingLocked: true, pin: "temporary",
  }, actions, new AbortController().signal, () => {}, () => {});
  const column = container.querySelector<HTMLElement>(".menu-column")!;
  vi.spyOn(column, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 36, 100, 100));
  const inside = new MouseEvent("pointerdown", { bubbles: true, composed: true, clientX: 10, clientY: 60 });
  column.dispatchEvent(inside);
  expect(column.isConnected).toBe(true);
  const external = document.createElement("button"); document.body.append(external);
  const received = vi.fn(); external.addEventListener("pointerdown", received);
  const outside = new MouseEvent("pointerdown", { bubbles: true, composed: true, cancelable: true, clientX: 300, clientY: 300 });
  external.dispatchEvent(outside);
  await session.closed;
  expect(column.isConnected).toBe(false);
  expect(received).toHaveBeenCalledOnce();
  expect(outside.defaultPrevented).toBe(false);
});

it("resumes hover closing after a pinned root is unlocked", async () => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: async () => [] } });
  const container = document.createElement("div"); document.body.append(container);
  const bar = document.createElement("div"); container.append(bar);
  const changed = vi.fn();
  const session = await openBrowserPopup(container, bar, "topLeft", {
    folder: { kind: "folder", uid: "folder", label: "Folder", children: [{ kind: "bookmark", uid: "child", label: "Child" }] },
    anchor: { left: 0, top: 0, right: 84, bottom: 36 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction: "down", editingLocked: true, pin: "temporary",
  }, { invokeAction: async () => {}, requestTemporarySave: async () => {}, requestToggleFold: async () => {} },
  new AbortController().signal, () => {}, changed);
  const column = container.querySelector<HTMLElement>(".menu-column")!;
  vi.useFakeTimers();
  session.setBarPointerInside(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(column.isConnected).toBe(true);
  await session.togglePin("temporary");
  await vi.advanceTimersByTimeAsync(100);
  expect(column.isConnected).toBe(false);
  expect(changed).toHaveBeenLastCalledWith("none", "none");
  await session.closed;
});

it.each(["temporary", "locked"] as const)("keeps a right-locked root through outside and bookmark clicks, then unlocks with either button (%s)", async unlockPin => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { load: async () => [] } });
  const container = document.createElement("div"); document.body.append(container);
  const bar = document.createElement("div"); container.append(bar);
  const invokeAction = vi.fn(async () => {});
  const session = await openBrowserPopup(container, bar, "topLeft", {
    folder: { kind: "folder", uid: "folder", label: "Folder", expandOnHover: false, children: [{ kind: "bookmark", uid: "child", label: "Child" }] },
    anchor: { left: 0, top: 0, right: 84, bottom: 36 },
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 }, direction: "down", editingLocked: true, pin: "locked",
  }, { invokeAction, requestTemporarySave: async () => {}, requestToggleFold: async () => {} },
  new AbortController().signal, () => {}, () => {});
  const column = container.querySelector<HTMLElement>(".menu-column")!;
  const outside = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
  document.body.dispatchEvent(outside);
  expect(column.isConnected).toBe(true);
  expect(outside.defaultPrevented).toBe(false);
  column.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  expect(invokeAction).toHaveBeenCalledWith("child");
  expect(column.isConnected).toBe(true);
  await session.togglePin(unlockPin);
  vi.useFakeTimers(); session.setBarPointerInside(false);
  column.dispatchEvent(new Event("pointerleave"));
  await vi.advanceTimersByTimeAsync(100);
  expect(column.isConnected).toBe(false);
  await session.closed;
});
