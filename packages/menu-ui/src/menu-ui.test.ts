// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountBar, mountFolderPopup, createCustomizationRail } from "./index";
import type { BarHost, BarState, Controller, PopupHost, PopupState, Rect, PopupPin, FolderPin } from "./types";

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
      togglePin: async () => {}, dismiss: async () => {}, close: async () => {}, requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
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
  it("keeps configured icons, aliases and full labels together in bars and editing previews", async () => {
    const root = container(); const state = barState();
    state.menu.style = "tiles";
    state.menu.items = [
      { kind: "bookmark", uid: "one", label: "Original", rename: "中文名称", icon: { type: "initial" } },
      { kind: "bookmark", uid: "two", label: "Two", icon: { type: "text", text: "AB" } },
      { kind: "bookmark", uid: "three", label: "Three", icon: { type: "lucide", name: "book" }, iconMask: 'url("data:image/svg+xml,book")' },
      { kind: "bookmark", uid: "four", label: "GitHub", icon: { type: "initial", length: 2 } },
      { kind: "bookmark", uid: "five", label: "你好世界", icon: { type: "initial", length: 2 } },
      { kind: "bookmark", uid: "six", label: "Plain" },
    ];
    const controller = mount(root, state, host()); await controller.ready;
    const preview = createCustomizationRail(container(), state);
    for (const surface of [root, preview]) {
      const buttons = [...surface.querySelectorAll<HTMLButtonElement>(".menu-button")];
      expect(buttons.map(button => button.ariaLabel)).toEqual(["中文名称", "Two", "Three", "GitHub", "你好世界", "Plain"]);
      const icons = buttons.map(button => button.querySelector<HTMLElement>(".menu-button-icon")!);
      expect(icons.map(icon => icon.dataset.text)).toEqual(["中", "AB", "", "Gi", "你好", "P"]);
      // Only unconfigured items take the bar style's default (bookmark or initial); a chosen prefix stays text.
      expect(icons.map(icon => icon.hasAttribute("data-default"))).toEqual([false, false, false, false, false, true]);
      // Bar CSS shrinks multi-character text by this count so it fits inside the icon.
      expect(icons.map(icon => icon.style.getPropertyValue("--icon-text-em"))).toEqual(["", "1.5", "", "1.5", "2", ""]);
      expect(icons[2]!.style.getPropertyValue("--config-icon")).toBe(state.menu.items[2]!.iconMask);
    }
    await controller.update({ ...state, menu: { ...state.menu, items: [{ kind: "bookmark", uid: "one", label: "Updated", icon: { type: "text", text: "新" } }] } });
    expect(root.querySelector<HTMLElement>(".menu-button-icon")!.dataset.text).toBe("新");
    expect(root.querySelector("button")!.ariaLabel).toBe("Updated");
  });

  it("exposes bar and item CSS classes in bars and editing previews and removes replaced classes", async () => {
    const state = barState();
    state.menu.cssClass = " icon-bar compact-rail ";
    state.menu.items[0]!.cssClass = " icon-home compact ";
    const root = container();
    const controller = mount(root, state, host());
    await controller.ready;
    expect(root.querySelector(".menu-bar.icon-bar.compact-rail")?.textContent).toBe("One");
    expect(root.querySelector(".menu-button.icon-home.compact")?.textContent).toBe("One");
    const preview = createCustomizationRail(container(), state);
    expect(preview.matches(".icon-bar.compact-rail")).toBe(true);
    expect(preview.querySelector(".menu-button.icon-home.compact")?.textContent).toBe("One");
    await controller.update({ ...state, menu: { ...state.menu, cssClass: "other-bar", items: [{ ...state.menu.items[0]!, cssClass: "icon-folder" }] } });
    expect(root.querySelector(".menu-button.icon-folder")?.textContent).toBe("One");
    expect(root.querySelector(".menu-bar.other-bar")?.textContent).toBe("One");
    expect(root.querySelector(".icon-home, .compact, .icon-bar, .compact-rail")).toBeNull();
  });

  it("renders the shortcut status placeholder and dispatches its action even while off", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.items = [{ kind: "shortcutsToggle", uid: "shortcutsToggle:keys", label: "Keys {on}", on: true }];
    const controller = mount(root, state, adapter);
    await controller.ready;
    let button = root.querySelector<HTMLButtonElement>("button")!;
    expect(button.title).not.toContain("{on}");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).not.toContain("{on}");
    const onTitle = button.title;
    await controller.update({ ...state, menu: { ...state.menu, items: [{ kind: "shortcutsToggle", uid: "shortcutsToggle:keys", label: "Keys {on}", on: false }] } });
    button = root.querySelector<HTMLButtonElement>("button")!;
    expect(button.title).not.toBe(onTitle);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    press(button, 2);
    expect(adapter.invokeAction).not.toHaveBeenCalled();
    press(button);
    expect(adapter.invokeAction).toHaveBeenCalledWith("shortcutsToggle:keys");
  });

  it("keeps a failure visible until the host reports success, including an alternate click", async () => {
    const root = container(); const adapter = host();
    vi.mocked(adapter.invokeAction).mockRejectedValueOnce(new Error("Missing variable"));
    const controller = mountBar(root, barState(), adapter); controllers.push(controller);
    await controller.ready;
    const button = root.querySelector<HTMLButtonElement>("button")!;
    press(button);
    await vi.waitFor(() => expect(button.title).toContain("Missing variable"));
    expect(button.querySelector(".menu-action-error")).not.toBeNull();
    press(button, 2);
    await Promise.resolve();
    expect(button.title).toContain("Missing variable");
    controller.setActionError("bookmark:one?tab=newTab");
    expect(button.title).toBe("One");
    expect(button.querySelector(".menu-action-error")).toBeNull();
  });

  it("shows a popup action failure on its owning bar folder, preserves it across updates, and isolates other menus", async () => {
    const root = container(); const other = container(); const state = barState();
    state.menu.items = [{ kind: "folder", uid: "folder", label: "Folder", children: [
      { kind: "folder", uid: "nested", label: "Nested", children: [{ kind: "bookmark", uid: "static:child", label: "Child" }] },
    ] }];
    const controller = mountBar(root, state, host()); controllers.push(controller);
    await Promise.all([controller.ready, mount(other, state, host()).ready]);
    controller.setActionError("static:child?tab=newTab", "Missing author");
    expect(root.querySelector("button")!.title).toContain("Missing author");
    expect(other.querySelector("button")!.title).toBe("Folder");
    await controller.update({ ...state, itemSize: { width: 90, height: 40 } });
    expect(root.querySelector("button")!.title).toContain("Missing author");
    controller.setActionError("static:child");
    expect(root.querySelector("button")!.title).toBe("Folder");
  });

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
      togglePin: async () => {}, dismiss: async () => {}, close: async () => close(), requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
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
      return { togglePin: async () => {}, dismiss: async () => {}, close, closed, requestClose() {}, cancelClose() {}, setBarPointerInside() {} };
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

  it("pins a hovered folder on click, retains it across sibling hover, and releases it on a bookmark click", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.items.unshift(...["A", "B"].map(uid => ({ kind: "folder" as const, uid, label: uid,
      children: [{ kind: "bookmark" as const, uid: "child", label: "Child" }] })));
    const close = vi.fn(async () => {}); const togglePin = vi.fn(async () => {});
    adapter.openPopup = vi.fn(async (_request, _inside, changed) => ({
      togglePin: async (pin: FolderPin) => { togglePin(); changed(pin, pin); }, dismiss: async () => {}, close,
      closed: new Promise<void>(() => {}), requestClose() {}, cancelClose() {}, setBarPointerInside() {},
    }));
    await mount(root, state, adapter).ready;
    vi.useFakeTimers();
    const [a, b, bookmark] = root.querySelectorAll("button");
    a!.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(100);
    press(a!);
    await vi.advanceTimersByTimeAsync(0);
    expect(togglePin).toHaveBeenCalledOnce();
    a!.dispatchEvent(new Event("pointerleave"));
    b!.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(500);
    bookmark!.dispatchEvent(new Event("pointerenter"));
    expect(adapter.openPopup).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    press(bookmark!);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
  });
});

it("unlocks a pinned bar folder on a second click and lets hover switch folders again", async () => {
  const root = container(); const adapter = host(); const state = barState();
  state.menu.items = ["A", "B"].map(uid => ({ kind: "folder", uid, label: uid,
    children: [{ kind: "bookmark", uid: `${uid}-link`, label: `${uid} link` }] }));
  adapter.openPopup = vi.fn(async (_request, _inside, changed) => ({
    togglePin: async () => { changed("none", "none"); }, dismiss: async () => {}, close: async () => {},
    closed: new Promise<void>(() => {}), requestClose() {}, cancelClose() {}, setBarPointerInside() {},
  }));
  await mount(root, state, adapter).ready;
  vi.useFakeTimers();
  const [a, b] = root.querySelectorAll("button");
  press(a!); await vi.advanceTimersByTimeAsync(0);
  press(a!); await vi.advanceTimersByTimeAsync(0);
  b!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(100);
  expect(adapter.openPopup).toHaveBeenLastCalledWith(expect.objectContaining({ folder: expect.objectContaining({ uid: "B" }), pin: "none" }), expect.any(Function), expect.any(Function));
});

it("lets a click-only bar folder replace a temporary pin using its normal left click", async () => {
  const root = container(); const adapter = host(); const state = barState();
  state.menu.items = [
    { kind: "folder", uid: "hover", label: "Hover", children: [{ kind: "bookmark", uid: "one", label: "One" }] },
    { kind: "folder", uid: "click", label: "Click", expandOnHover: false, children: [{ kind: "bookmark", uid: "two", label: "Two" }] },
  ];
  await mount(root, state, adapter).ready;
  vi.useFakeTimers();
  const [hover, click] = root.querySelectorAll("button");
  press(hover!); await vi.advanceTimersByTimeAsync(0);
  press(click!); await vi.advanceTimersByTimeAsync(0);
  expect(adapter.openPopup).toHaveBeenLastCalledWith(expect.objectContaining({ folder: expect.objectContaining({ uid: "click" }), pin: "none" }), expect.any(Function), expect.any(Function));
});

describe("bar auto-hide", () => {
  it("keeps CSS-sized button interiors clickable while gaps pass through and restores the window for editing", async () => {
    const root = container(); const adapter = host(); const state = barState();
    root.style.setProperty("--bar-background-pointer-events", "none");
    state.menu.items.push({ kind: "bookmark", uid: "bookmark:two", label: "Two" });
    // Happy DOM does not inherit custom properties into computed styles.
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const style = computedStyle(element);
      if (element.classList.contains("menu-bar")) {
        const property = style.getPropertyValue.bind(style);
        vi.spyOn(style, "getPropertyValue").mockImplementation(name =>
          name === "--bar-background-pointer-events" ? "none" : property(name));
      }
      return style;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === root) return new DOMRect(100, 200, 100, 50);
      if (this.classList.contains("menu-button")) {
        return new DOMRect(this.dataset.uid === "bookmark:one" ? 110 : 160, 210, 30, 30);
      }
      return new DOMRect();
    });
    let regions: Rect[] | null = null;
    adapter.commitHitRegion = async next => { regions = next; };
    const accepts = (x: number, y: number): boolean => regions === null || regions.some(rect =>
      x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom);
    const controller = mount(root, state, adapter); await controller.ready;
    expect(accepts(11, 11)).toBe(true);
    expect(accepts(39, 39)).toBe(true);
    expect(accepts(61, 11)).toBe(true);
    expect(accepts(50, 20)).toBe(false);
    expect(accepts(0, 0)).toBe(false);
    press(root.querySelector("button")!);
    expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
    await controller.update({ ...state, editingLocked: false });
    expect(accepts(50, 20)).toBe(true);
    await controller.update(state);
    expect(accepts(50, 20)).toBe(false);
    controller.destroy();
    expect(accepts(50, 20)).toBe(true);
  });

  it.each([
    ["column", "start"], ["column", "end"], ["row", "start"], ["row", "end"],
  ] as const)("moves the chosen band to the hiding edge and restores the full bar on hover (%s/%s)", async (orientation, autoHide) => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu = { ...state.menu, orientation, autoHide, autoHideRange: { start: .25, end: .5 }, autoHidePadding: 3 };
    const regions: Array<Rect[] | null> = [];
    adapter.commitHitRegion = async region => { regions.push(region); };
    const controller = mount(root, state, adapter); await controller.ready;
    const extent = orientation === "column" ? 86 : 38;
    const hit = regions.at(-1)![0]!;
    const start = autoHide === "start" ? 0 : extent * .75;
    const end = start + extent * .25;
    expect(orientation === "column" ? hit!.left : hit!.top).toBeCloseTo(Math.max(0, start - 3));
    expect(orientation === "column" ? hit!.right : hit!.bottom).toBeCloseTo(Math.min(extent, end + 3));
    const content = root.querySelector<HTMLElement>(".bar-content")!;
    const offset = start - extent * .25;
    expect(content.style.transform).toBe(orientation === "column" ? `translate(${offset}px, 0px)` : `translate(0px, ${offset}px)`);
    // Clipping before translation keeps exactly the user's selected source band.
    const clipped = content.style.clipPath.match(/-?[\d.]+/g)!.map(Number);
    expect(orientation === "column" ? clipped[3] : clipped[0]).toBeCloseTo(extent * .25);
    expect(orientation === "column" ? clipped[1] : clipped[2]).toBeCloseTo(extent * .5);
    press(root.querySelector("button")!); expect(adapter.invokeAction).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const viewport = root.querySelector<HTMLElement>(".bar-viewport")!;
    viewport.dispatchEvent(new Event("pointerenter")); await vi.advanceTimersByTimeAsync(200);
    expect(regions.at(-1)).toBeNull(); expect(content.style.clipPath).toBe(""); expect(content.style.transform).toBe("");
    press(root.querySelector("button")!); expect(adapter.invokeAction).toHaveBeenCalledWith("bookmark:one");
    viewport.dispatchEvent(new Event("pointerleave")); await vi.advanceTimersByTimeAsync(200);
    expect(regions.at(-1)).toEqual([hit]);
    await controller.update({ ...state, itemSize: { width: 168, height: 72 } });
    const resized = orientation === "column" ? 170 : 74;
    const nextHit = regions.at(-1)![0]!;
    expect(orientation === "column" ? nextHit!.left : nextHit!.top).toBeCloseTo(autoHide === "start" ? 0 : resized * .75 - 3);
    expect(orientation === "column" ? nextHit!.right : nextHit!.bottom).toBeCloseTo(autoHide === "start" ? resized * .25 + 3 : resized);
    await controller.update({ ...state, editingLocked: false });
    expect(regions.at(-1)).toBeNull(); expect(root.querySelector<HTMLElement>(".bar-content")!.style.clipPath).toBe("");
  });

  it("limits the wake area to the full bar even when the chosen band touches an edge", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu = { ...state.menu, orientation: "column", autoHide: "end", autoHideRange: { start: .9, end: 1 }, autoHidePadding: 1000 };
    adapter.commitHitRegion = vi.fn(async () => {});
    await mount(root, state, adapter).ready;
    expect(adapter.commitHitRegion).toHaveBeenLastCalledWith([{ left: 0, top: 0, right: 86, bottom: 46 }]);
  });

  it.each(["column", "row"] as const)("expands the wake area by the configured amount and can restore its original size (%s)", async orientation => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu = { ...state.menu, orientation, autoHide: "start", autoHidePadding: 0 };
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next?.[0] ?? null; };
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
    const regions: Array<Rect[] | null> = [];
    adapter.commitHitRegion = async region => { regions.push(region); };
    await mount(root, state, adapter).ready;
    const edge = regions.at(-1)![0]!;
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
    expect(regions.at(-1)).toEqual([edge]);
  });

  it("disables hiding as soon as editing is unlocked and preserves the configured direction", async () => {
    const root = container(); const adapter = host(); const state = barState();
    state.menu.autoHide = "end";
    state.menu.items.push({ kind: "menuFold", uid: "fold", label: "Fold" });
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next?.[0] ?? null; };
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
    state.menu.items = [{ kind: "folder", uid: "folder", label: "Folder", expandOnHover: true,
      children: [{ kind: "bookmark", uid: "child", label: "Child" }] }];
    let pointerInside!: (inside: boolean) => void;
    let region: Rect | null = null;
    adapter.commitHitRegion = async next => { region = next?.[0] ?? null; };
    const close = vi.fn();
    adapter.openPopup = async (_request, pointer) => {
      pointerInside = pointer;
      let closed!: () => void;
      const done = new Promise<void>(resolve => { closed = resolve; });
      close.mockImplementation(async () => closed());
      return { togglePin: async () => {}, dismiss: async () => {}, close, closed: done, requestClose() {}, cancelClose() {}, setBarPointerInside() {} };
    };
    await mount(root, state, adapter).ready;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const viewport = root.querySelector(".bar-viewport")!;
    viewport.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(200);
    root.querySelector("button")!.dispatchEvent(new Event("pointerenter"));
    await vi.advanceTimersByTimeAsync(100);
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
    pin: "none", setPin: vi.fn(async () => {}),
    invokeAction: vi.fn(async () => {}), requestToggleFold: vi.fn(async () => {}), requestTemporarySave: vi.fn(async () => {}),
    close: vi.fn(async () => {}), setPointerInside: vi.fn(), commitLayout: vi.fn(async () => {}),
  };
}

it("keeps a clicked child layer while hovering its siblings, allows explicit switching, and closes the chain on navigation", async () => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  let pin: PopupPin = "none";
  Object.defineProperty(adapter, "pin", { get: () => pin });
  adapter.setPin = async next => { pin = next; };
  state.entries = [
    { kind: "folder", uid: "a", label: "A", children: [
      { kind: "folder", uid: "nested", label: "Nested", children: [{ kind: "bookmark", uid: "deep", label: "Deep" }] },
      { kind: "bookmark", uid: "a-link", label: "A link" },
    ] },
    { kind: "folder", uid: "b", label: "B", children: [{ kind: "bookmark", uid: "b-link", label: "B link" }] },
    { kind: "bookmark", uid: "root-link", label: "Root link" },
  ];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const [a, b, rootLink] = root.querySelectorAll<HTMLButtonElement>("button");
  press(a!);
  b!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(500);
  rootLink!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(500);
  expect(root.textContent).toContain("A link");
  expect(root.textContent).not.toContain("B link");
  const child = root.querySelectorAll<HTMLElement>(".menu-column")[1]!;
  child.querySelector("button")!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(100);
  expect(root.textContent).toContain("Deep");
  root.querySelectorAll<HTMLElement>(".menu-column")[2]!.dispatchEvent(new Event("pointerleave"));
  expect(root.textContent).not.toContain("Deep");
  expect(root.textContent).toContain("A link");
  press(b!);
  expect(root.textContent).toContain("B link");
  expect(root.textContent).not.toContain("A link");
  press(root.querySelectorAll<HTMLElement>(".menu-column")[1]!.querySelector("button")!);
  expect(adapter.close).toHaveBeenCalledOnce();
  expect(adapter.invokeAction).toHaveBeenCalledWith("b-link");
});

it("unlocks a clicked child branch on a second click while keeping its parent pinned", async () => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  let pin: PopupPin = "none";
  Object.defineProperty(adapter, "pin", { get: () => pin });
  adapter.setPin = async next => { pin = next; };
  state.entries = [
    { kind: "folder", uid: "a", label: "A", children: [
      { kind: "folder", uid: "nested", label: "Nested", children: [{ kind: "bookmark", uid: "deep", label: "Deep" }] },
      { kind: "bookmark", uid: "a-link", label: "A link" },
    ] },
    { kind: "bookmark", uid: "root-link", label: "Root link" },
  ];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const a = root.querySelector("button")!;
  press(a);
  const child = root.querySelectorAll<HTMLElement>(".menu-column")[1]!;
  const nested = child.querySelector("button")!;
  press(nested); press(nested);
  child.querySelectorAll("button")[1]!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(500);
  expect(root.textContent).not.toContain("Deep");
  expect(root.textContent).toContain("A link");
  root.querySelectorAll<HTMLElement>(".menu-column")[0]!.querySelectorAll("button")[1]!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(500);
  expect(root.textContent).toContain("A link");
  press(a);
  child.dispatchEvent(new Event("pointerleave"));
  expect(root.textContent).not.toContain("A link");
  expect(adapter.close).not.toHaveBeenCalled();
});

it.each([0, 2])("keeps right-locked layers through other clicks and releases only the clicked folder (%s)", async mouseButton => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  state.entries = [
    { kind: "folder", uid: "a", label: "A", children: [
      { kind: "folder", uid: "nested", label: "Nested", children: [{ kind: "bookmark", uid: "deep", label: "Deep" }] },
      { kind: "bookmark", uid: "a-link", label: "A link" },
    ] },
    { kind: "folder", uid: "b", label: "B", children: [{ kind: "bookmark", uid: "b-link", label: "B link" }] },
    { kind: "bookmark", uid: "root-link", label: "Root link" },
  ];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const [a, b, rootLink] = root.querySelectorAll<HTMLButtonElement>("button");
  press(a!, 2);
  const child = root.querySelectorAll<HTMLElement>(".menu-column")[1]!;
  const nested = child.querySelector("button")!;
  press(nested, 2);
  press(a!, mouseButton);
  press(b!, 2);
  b!.dispatchEvent(new Event("pointerenter"));
  await vi.advanceTimersByTimeAsync(500);
  press(rootLink!);
  controller.dismiss();
  expect(adapter.invokeAction).toHaveBeenCalledWith("root-link");
  expect(adapter.close).not.toHaveBeenCalled();
  expect(root.textContent).toContain("Deep");
  expect(root.textContent).not.toContain("B link");
  press(nested, mouseButton);
  controller.dismiss();
  expect(adapter.close).toHaveBeenCalledOnce();
});

it("upgrades a temporary pin with a right click and unlocks it on the next right click", async () => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  state.entries = [{ kind: "folder", uid: "folder", label: "Folder",
    children: [{ kind: "bookmark", uid: "child", label: "Child link" }] }];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  const folder = root.querySelector("button")!;
  press(folder); press(folder, 2);
  controller.dismiss();
  expect(root.textContent).toContain("Child link");
  expect(adapter.close).not.toHaveBeenCalled();
  press(folder, 2); controller.dismiss();
  expect(adapter.close).toHaveBeenCalledOnce();
});

it.each([0, 2])("keeps left-click expansion for click-only folders and unlocks their right-click lock with either button (%s)", async mouseButton => {
  const root = container(); const adapter = popupHost(); const state = popupState();
  state.entries = [{ kind: "folder", uid: "folder", label: "Folder", expandOnHover: false,
    children: [{ kind: "bookmark", uid: "child", label: "Child link" }] }];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  const folder = root.querySelector("button")!;
  press(folder);
  expect(root.textContent).toContain("Child link");
  expect(adapter.setPin).not.toHaveBeenCalled();
  press(folder);
  expect(root.textContent).not.toContain("Child link");
  press(folder, 2); controller.dismiss();
  expect(root.textContent).toContain("Child link");
  expect(adapter.close).not.toHaveBeenCalled();
  press(folder, mouseButton);
  expect(adapter.setPin).toHaveBeenLastCalledWith("none", "none");
  press(folder);
  expect(root.textContent).not.toContain("Child link");
});

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
  state.entries = [
    { kind: "folder", uid: "parent", label: "Parent", expandOnHover: false,
      children: [{ kind: "bookmark", uid: "temporary:slot", label: "Later" }] },
    { kind: "folder", uid: "other", label: "Other", children: [{ kind: "bookmark", uid: "other-child", label: "Other child" }] },
  ];
  const controller = mountFolderPopup(root, state, adapter); controllers.push(controller); await controller.ready;
  const parent = root.querySelector<HTMLButtonElement>("button")!;
  press(parent);
  const child = [...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Later")!;
  child.setPointerCapture = vi.fn(); child.hasPointerCapture = () => false;
  vi.useFakeTimers();
  child.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { button: 0, bubbles: true }), { pointerId: 7 }));
  press([...root.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Other")!);
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
    togglePin: async () => {}, dismiss: async () => {}, close: async () => closed(), requestClose: () => {}, cancelClose: () => {}, setBarPointerInside: () => {},
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
      togglePin: async () => {}, dismiss: async () => {},
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
