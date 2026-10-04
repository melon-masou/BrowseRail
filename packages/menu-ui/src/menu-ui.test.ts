// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBar, mountFolderPopup, createCustomizationRail } from "./index";
import type { BarHost, BarState, Controller, PopupHost, PopupState, Rect } from "./types";

const controllers: Array<{ destroy(): void }> = [];
beforeEach(() => {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function container(shadow = false): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = document.createElement("div");
  (shadow ? host.attachShadow({ mode: "open" }) : host).append(root);
  return root;
}
function barState(): BarState {
  return {
    menu: { uid: "menu", orientation: "row", items: [{ kind: "bookmark", uid: "bookmark:one", label: "One" }] },
    itemSize: { width: 84, height: 36 }, collapsed: false, editingLocked: true, fontFamily: "sans-serif",
  };
}
function host(): BarHost {
  return {
    invokeAction: vi.fn(async () => {}), requestToggleFold: vi.fn(async () => {}),
    requestTemporarySave: vi.fn(async () => {}), requestCustomize: vi.fn(async () => {}),
    openPopup: vi.fn(async () => ({
      close: async () => {}, requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
      closed: new Promise<void>(() => {}),
    })),
  };
}
function press(button: HTMLElement, mouseButton = 0): void {
  button.dispatchEvent(new MouseEvent("pointerdown", { button: mouseButton, bubbles: true, cancelable: true }));
}
function mount(root: HTMLElement, state: BarState, adapter: BarHost): Controller<BarState> {
  const controller = mountBar(root, state, adapter); controllers.push(controller); return controller;
}

describe("shared menu mounting", () => {
  it("renders when its own fonts are ready even if the host page fonts are still loading", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>(() => {}) } });
    const root = container(); const adapter = host();
    adapter.waitForFonts = async () => {};
    const controller = mount(root, barState(), adapter);
    await controller.ready;
    press(root.querySelector("button")!);
    expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
  });

  it("keeps menu labels visible while customizing in native and browser containers", () => {
    const root = container();
    const state = barState();
    state.menu.items.push({ kind: "menuFold", uid: "fold", label: "Fold" });
    const rail = createCustomizationRail(root, state);
    root.append(rail);
    expect(Array.from(rail.querySelectorAll("button"), button => button.textContent)).toEqual(["One", "Fold"]);
  });

  it("completes a destroyed mount even while document fonts are still loading", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>(() => {}) } });
    const controller = mount(container(), barState(), host());
    const update = controller.update(barState());
    controller.destroy();
    await Promise.all([controller.ready, update]);
  });

  it.each([false, true])("dispatches from a browser container (shadow=%s) without a native host", async shadow => {
    const root = container(shadow);
    const adapter = host();
    const controller = mount(root, barState(), adapter);
    await controller.ready;
    press(root.querySelector<HTMLButtonElement>("button")!);
    expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
  });

  it("keeps actions and updates isolated between menus in the same document", async () => {
    const a = container(); const b = container();
    const hostA = host(); const hostB = host();
    const state = barState();
    const controllerA = mount(a, state, hostA); const controllerB = mount(b, state, hostB);
    await Promise.all([controllerA.ready, controllerB.ready]);
    await controllerA.update({ ...state, menu: { ...state.menu, items: [{ kind: "browserAction", uid: "browserAction:back", label: "Back" }] } });
    press(a.querySelector("button")!);
    expect(hostA.invokeAction).toHaveBeenCalledWith("browserAction:back");
    expect(hostB.invokeAction).not.toHaveBeenCalled();
    expect(b.textContent).toBe("One");
  });

  it("routes an unlocked bar to host customization rather than navigating", async () => {
    const root = container(); const adapter = host();
    await mount(root, { ...barState(), editingLocked: false }, adapter).ready;
    press(root.querySelector("button")!);
    expect(adapter.requestCustomize).toHaveBeenCalledOnce();
    expect(adapter.invokeAction).not.toHaveBeenCalled();
  });

  it("renders only the fold button while collapsed and asks the host to expand", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.items.push({ kind: "menuFold", uid: "fold", label: "Fold" });
    await mount(root, { ...state, collapsed: true }, adapter).ready;
    expect(root.querySelectorAll("button")).toHaveLength(1);
    press(root.querySelector("button")!);
    await vi.waitFor(() => expect(adapter.requestToggleFold).toHaveBeenCalledOnce());
    expect(adapter.invokeAction).not.toHaveBeenCalled();
  });

  it("applies a deferred menu update after the host closes its popup", async () => {
    const root = container(); const adapter = host(); const state = barState();
    let close!: () => void;
    adapter.openPopup = vi.fn(async () => ({
      close: async () => close(), requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
      closed: new Promise<void>(resolve => { close = resolve; }),
    }));
    state.menu.items = [{ kind: "folder", uid: "folder", label: "Folder", expandOnHover: false,
      children: [{ kind: "bookmark", uid: "bookmark:child", label: "Child" }] }];
    const controller = mount(root, state, adapter); await controller.ready;
    press(root.querySelector("button")!);
    await Promise.resolve(); await Promise.resolve();
    const changed = { ...state, menu: { ...state.menu, items: [{ kind: "bookmark" as const, uid: "bookmark:new", label: "New" }] } };
    const updated = controller.update(changed);
    expect(root.textContent).toBe("Folder");
    close();
    await updated;
    expect(root.textContent).toBe("New");
  });

  it("does not open a folder whose hover was cancelled by unmounting", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.items = [{ kind: "folder", uid: "folder", label: "Folder", children: [{ kind: "bookmark", uid: "bookmark:c", label: "Child" }] }];
    const controller = mount(root, state, adapter); await controller.ready;
    vi.useFakeTimers();
    root.querySelector("button")!.dispatchEvent(new Event("pointerenter"));
    controller.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.openPopup).not.toHaveBeenCalled();
  });

  it.each([false, true])("closes a folder when hovering a plain button even while opening=%s", async pending => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.items.unshift({ kind: "folder", uid: "folder", label: "Folder",
      children: [{ kind: "bookmark", uid: "bookmark:child", label: "Child" }] });
    let finishOpening!: () => void;
    const opening = new Promise<void>(resolve => { finishOpening = resolve; });
    let finishClosing!: () => void;
    const closed = new Promise<void>(resolve => { finishClosing = resolve; });
    const close = vi.fn(async () => { finishClosing(); });
    adapter.openPopup = vi.fn(async () => {
      if (pending) await opening;
      return { close, closed, requestClose() {}, cancelClose() {}, setBarPointerInside() {} };
    });
    await mount(root, state, adapter).ready;
    vi.useFakeTimers();
    const [folder, bookmark] = root.querySelectorAll("button");
    folder!.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.openPopup).toHaveBeenCalledOnce();
    folder!.dispatchEvent(new Event("pointerleave"));
    bookmark!.dispatchEvent(new Event("pointerenter"));
    finishOpening();
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(adapter.invokeAction).not.toHaveBeenCalled();
  });

  it("cancels a pending temporary hold when the bar is destroyed", async () => {
    const root = container(true); const adapter = host(); const state = barState();
    state.menu.items = [{ kind: "bookmark", uid: "temporary:slot", label: "Later" }];
    const controller = mount(root, state, adapter); await controller.ready;
    const button = root.querySelector<HTMLButtonElement>("button")!;
    button.setPointerCapture = vi.fn(); button.hasPointerCapture = () => false;
    vi.useFakeTimers();
    button.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { button: 0, bubbles: true }), { pointerId: 7 }));
    controller.destroy();
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.requestTemporarySave).not.toHaveBeenCalled();
    expect(adapter.invokeAction).not.toHaveBeenCalled();
  });
});

describe("bar auto-hide", () => {
  it.each(["column", "row"] as const)("expands the wake area by the configured amount and can restore its original size (%s)", async orientation => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu = { ...state.menu, orientation, autoHide: "start", autoHidePadding: 0 };
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next; };
    const size = (): number => orientation === "column" ? region!.right - region!.left : region!.bottom - region!.top;
    const controller = mount(root, state, adapter); await controller.ready;
    const original = size();
    await controller.update({ ...state, menu: { ...state.menu, autoHidePadding: 18 } });
    expect(size()).toBe(original + 18);
    press(root.querySelector("button")!);
    expect(adapter.invokeAction).not.toHaveBeenCalled();
    await controller.update(state);
    expect(size()).toBe(original);
  });

  it.each([
    ["column", "start"], ["column", "end"], ["row", "start"], ["row", "end"],
  ] as const)("keeps a clickable edge and reveals without changing the bar layout (%s/%s)", async (orientation, autoHide) => {
    const root = container(true); const adapter = host(); const state = barState();
    state.menu = { ...state.menu, orientation, autoHide };
    const regions: Array<Rect | null> = [];
    adapter.commitHitRegion = async region => { regions.push(region); };
    await mount(root, state, adapter).ready;
    const edge = regions.at(-1)!;
    expect(edge).not.toBeNull();
    const horizontal = orientation === "column";
    expect(horizontal ? edge!.right - edge!.left : edge!.bottom - edge!.top).toBeGreaterThan(0);
    expect(horizontal ? edge!.right - edge!.left : edge!.bottom - edge!.top).toBeLessThan(20);
    if (autoHide === "start") expect(horizontal ? edge!.left : edge!.top).toBe(0);
    else expect(horizontal ? edge!.left : edge!.top).toBeGreaterThan(0);
    const button = root.querySelector<HTMLButtonElement>("button")!;
    press(button);
    expect(adapter.invokeAction).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const viewport = root.querySelector<HTMLElement>(".bar-viewport")!;
    viewport.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(200);
    expect(regions.at(-1)).toBeNull();
    expect(root.querySelector("button")).toBe(button);
    press(button);
    expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
    viewport.dispatchEvent(new Event("pointerleave"));
    await vi.advanceTimersByTimeAsync(500);
    expect(regions.at(-1)).toEqual(edge);
  });

  it("disables hiding as soon as editing is unlocked and preserves the configured direction", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.autoHide = "end";
    state.menu.items.push({ kind: "menuFold", uid: "fold", label: "Fold" });
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next; };
    const controller = mount(root, state, adapter); await controller.ready;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    root.querySelector(".bar-viewport")!.dispatchEvent(new Event("pointerenter"));
    await controller.update({ ...state, editingLocked: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(region).toBeNull();
    press(root.querySelector("button")!);
    expect(adapter.requestCustomize).toHaveBeenCalledOnce();
    await controller.update(state);
    expect(region).not.toBeNull();
    await controller.update({ ...state, collapsed: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(region).toBeNull();
    expect(root.textContent).toBe("Fold");
  });

  it("stays revealed while the pointer is in its popup and hides after leaving both surfaces", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.autoHide = "start";
    state.menu.items = [{ kind: "folder", uid: "folder", label: "Folder", expandOnHover: false,
      children: [{ kind: "bookmark", uid: "child", label: "Child" }] }];
    let pointerInside!: (inside: boolean) => void;
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next; };
    const close = vi.fn();
    adapter.openPopup = async (_request, pointer) => {
      pointerInside = pointer;
      let closed!: () => void;
      const done = new Promise<void>(resolve => { closed = resolve; });
      close.mockImplementation(async () => closed());
      return { close, closed: done, requestClose() {}, cancelClose() {}, setBarPointerInside() {} };
    };
    await mount(root, state, adapter).ready;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const viewport = root.querySelector(".bar-viewport")!;
    viewport.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(200);
    press(root.querySelector("button")!);
    await vi.advanceTimersByTimeAsync(0);
    viewport.dispatchEvent(new Event("pointerleave"));
    pointerInside(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(region).toBeNull();
    pointerInside(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(region).not.toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});

function popupState(): PopupState {
  return {
    entries: [{ kind: "bookmark", uid: "bookmark:child", label: "Child" }],
    theme: { fontFamily: "sans-serif", fontSize: 13, itemHeight: 36 },
    direction: "right", rootDirection: "right", rootOffsetX: 0, rootOffsetY: 0,
    bounds: { left: 0, top: 0, right: 600, bottom: 600 }, maxColumnHeight: 600, editingLocked: true,
  };
}
function popupHost(): PopupHost {
  return {
    invokeAction: vi.fn(async () => {}), requestToggleFold: vi.fn(async () => {}), requestTemporarySave: vi.fn(async () => {}),
    close: vi.fn(async () => {}), setPointerInside: vi.fn(), commitLayout: vi.fn(async () => {}),
  };
}

it("does not mark a popup ready before its host commits the clickable columns", async () => {
  const root = container(true); const adapter = popupHost();
  let release!: () => void;
  const committed = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { adapter.commitLayout = vi.fn(async () => { resolve(); await committed; }); });
  const controller = mountFolderPopup(root, popupState(), adapter); controllers.push(controller);
  let ready = false; void controller.ready.then(() => { ready = true; });
  await received;
  expect(ready).toBe(false);
  expect(root.querySelectorAll(".menu-column")).toHaveLength(1);
  release(); await controller.ready;
  expect(ready).toBe(true);
  press(root.querySelector("button")!);
  expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:child");
  expect(adapter.close).toHaveBeenCalled();
});

it("rejects popup readiness when the host cannot commit its layout", async () => {
  const root = container(); const adapter = popupHost();
  adapter.commitLayout = vi.fn(async () => { throw new Error("Layout unavailable"); });
  const controller = mountFolderPopup(root, popupState(), adapter); controllers.push(controller);
  await expect(controller.ready).rejects.toThrow("Layout unavailable");
});

it("cancels a temporary hold when its popup column is removed", async () => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  state.entries = [{ kind: "folder", uid: "parent", label: "Parent", expandOnHover: false,
    children: [{ kind: "bookmark", uid: "temporary:slot", label: "Later" }] }];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  const parent = root.querySelector<HTMLButtonElement>("button")!;
  press(parent);
  const child = [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Later")!;
  child.setPointerCapture = vi.fn(); child.hasPointerCapture = () => false;
  vi.useFakeTimers();
  child.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { button: 0, bubbles: true }), { pointerId: 7 }));
  press(parent);
  expect(child.isConnected).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(adapter.requestTemporarySave).not.toHaveBeenCalled();
  expect(adapter.invokeAction).not.toHaveBeenCalled();
});

it("can fold a bar while its folder popup is open", async () => {
  const root = container(); const adapter = host(); const state = barState();
  state.menu.items = [
    { kind: "folder", uid: "folder", label: "Folder", expandOnHover: false,
      children: [{ kind: "bookmark", uid: "bookmark:c", label: "Child" }] },
    { kind: "menuFold", uid: "fold", label: "Fold" },
  ];
  let closed!: () => void;
  adapter.openPopup = vi.fn(async () => ({
    close: async () => closed(), requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
    closed: new Promise<void>(resolve => { closed = resolve; }),
  }));
  const controller = mount(root, state, adapter); await controller.ready;
  adapter.requestToggleFold = async () => { await controller.update({ ...state, collapsed: true }); };
  press(root.querySelector("button")!);
  await vi.waitFor(() => expect(adapter.openPopup).toHaveBeenCalled());
  const fold = [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Fold")!;
  press(fold);
  await vi.waitFor(() => expect(root.textContent).toBe("Fold"));
});


it("closes the previous popup before opening a different folder", async () => {
  const root = container(); const adapter = host(); const state = barState();
  state.menu.items = ["A", "B"].map(uid => ({ kind: "folder", uid, label: uid, expandOnHover: false,
    children: [{ kind: "bookmark", uid: "bookmark:child", label: "Child" }] }));
  let releaseClose!: () => void;
  const closing = new Promise<void>(resolve => { releaseClose = resolve; });
  const visible = new Set<string>();
  adapter.openPopup = vi.fn(async ({ folder }) => {
    visible.add(folder.uid);
    let closed!: () => void;
    const done = new Promise<void>(resolve => { closed = resolve; });
    return {
      close: async () => { await closing; visible.delete(folder.uid); closed(); }, closed: done,
      requestClose() {}, cancelClose() {}, setBarPointerInside() {},
    };
  });
  const controller = mount(root, state, adapter); await controller.ready;
  const [a, b] = root.querySelectorAll<HTMLButtonElement>("button");
  press(a!); await vi.waitFor(() => expect(visible.has("A")).toBe(true));
  await Promise.resolve();
  press(b!); await Promise.resolve();
  expect(visible.has("B")).toBe(false);
  releaseClose();
  await vi.waitFor(() => expect([...visible]).toEqual(["B"]));
});

it("remeasures popup columns after fonts load and change without closing its child menu", async () => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  state.entries = [{ kind: "folder", uid: "parent", label: "Parent", expandOnHover: false,
    children: [{ kind: "bookmark", uid: "bookmark:child", label: "Child" }] }];
  let loaded = false; let loadFont!: () => void;
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>(resolve => { loadFont = resolve; }) } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("menu-text-measure")) {
      const textWidth = !loaded ? 80 : root.style.getPropertyValue("--menu-font-family") === "FontB" ? 300 : 200;
      return new DOMRect(0, 0, textWidth, 36);
    }
    return new DOMRect(0, 0, Number.parseFloat(this.style.width) || 0, 36);
  });
  state.theme.fontFamily = "FontA";
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller);
  loaded = true; loadFont(); await controller.ready;
  const columnWidth = (): number => {
    const rect = vi.mocked(adapter.commitLayout).mock.lastCall![0].columns[0]!;
    return rect.right - rect.left;
  };
  expect(columnWidth()).toBeGreaterThanOrEqual(200);
  press(root.querySelector("button")!);
  const child = [...root.querySelectorAll("button")].find(button => button.textContent === "Child")!;
  await controller.update({ ...state, theme: { ...state.theme, fontFamily: "FontB" } });
  expect(columnWidth()).toBeGreaterThanOrEqual(300);
  expect(child.isConnected).toBe(true);
  expect(vi.mocked(adapter.commitLayout).mock.lastCall![0].columns).toHaveLength(2);
});
