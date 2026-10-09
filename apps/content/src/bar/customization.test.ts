// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { t } from "@browserail/i18n";
import { defaultBarSettings, type MenuView } from "@browserail/protocol";
import { mountBrowserCustomization } from "./customization";

function fixture(overrides: Partial<MenuView> = {}) {
  const wrapper = document.createElement("div");
  const root = document.createElement("div"); wrapper.append(root); document.body.append(wrapper);
  const menu: MenuView = { ...defaultBarSettings(), uid: "bar", items: [
    { kind: "bookmark", uid: "bookmark:a", label: "A" },
    { kind: "bookmark", uid: "bookmark:b", label: "B" },
  ], ...overrides };
  const initial = structuredClone(menu);
  const saved = vi.fn<Parameters<typeof mountBrowserCustomization>[4]>(async () => {});
  const canceled = vi.fn();
  const editor = mountBrowserCustomization(wrapper, root, { menu, itemSize: { width: 84, height: 36 }, collapsed: false, editingLocked: false, fontFamily: "sans-serif" }, { anchor: "topLeft", offsetX: 40, offsetY: 50, itemWidth: 84, itemHeight: 36 }, saved, canceled);
  function click(title: string) {
    const button = Array.from(wrapper.querySelectorAll("button")).find(button => button.title === title);
    if (!button) throw new Error(`Missing control ${title}`);
    button.click();
  }
  function changeOrientation() {
    click(`${t("menuSettings.direction")}: ${t("menuSettings.column")}`);
    click(t("bar.settings"));
  }
  function changeFont() {
    const input = Array.from(wrapper.querySelectorAll("select")).find(input => input.ariaLabel === t("settings.fontFamily"))!;
    input.value = "__custom__"; input.dispatchEvent(new Event("change", { bubbles: true }));
    const custom = Array.from(wrapper.querySelectorAll("input")).find(input => input.ariaLabel === t("bar.fontCustom"))!;
    custom.value = "Arial"; custom.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.style.getPropertyValue("--menu-font-family")).toMatch(/^"Arial",/);
  }
  return { menu, initial, saved, canceled, editor, wrapper, click, changeOrientation, changeFont };
}

it("keeps settings in the draft until toolbar Save, preserving button size and bar position when direction changes", async () => {
  const f = fixture(); f.changeOrientation();
  f.changeFont();
  expect(f.menu).toEqual(f.initial);
  expect(f.saved).not.toHaveBeenCalled();
  f.click(t("customize.savePlacement"));
  await Promise.resolve();
  expect(f.saved).toHaveBeenCalledWith(
    { anchor: "topLeft", offsetX: 40, offsetY: 50, itemWidth: 84, itemHeight: 36 },
    expect.objectContaining({ extraGaps: {} }),
    expect.objectContaining({ orientation: "row", fontFamily: "Arial" }),
  );
  f.editor.destroy(); f.wrapper.remove();
});

it("discards settings with toolbar Cancel and removes the settings popup on destruction", () => {
  const f = fixture(); f.changeOrientation();
  f.changeFont();
  f.click(t("customize.cancel"));
  expect(f.canceled).toHaveBeenCalled();
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.editor.destroy();
  expect(f.wrapper.querySelector("select")).toBeNull();
  f.wrapper.remove();
});

it.each(["column", "row"] as const)("drags the hidden area's boundary and preserves it when changing another setting (%s)", async orientation => {
  const f = fixture({ orientation, autoHide: "start", autoHideRange: { start: .1, end: .3 } });
  f.click(t("customize.hideRange"));
  const handle = f.wrapper.querySelectorAll<HTMLElement>('[role="slider"]')[1]!;
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => false;
  // Include the existing bar frame in the selection, as in the hidden surface.
  const extent = orientation === "column" ? 86 : 38;
  for (const [type, delta] of [["pointerdown", 0], ["pointermove", extent * .2], ["pointerup", extent * .2]] as const) {
    handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0,
      screenX: orientation === "column" ? delta : 0, screenY: orientation === "row" ? delta : 0 }));
  }
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.click(t("bar.settings")); f.changeFont();
  f.click(t("customize.savePlacement")); await Promise.resolve();
  const [placement, , settings] = f.saved.mock.calls[0]!;
  expect(placement).toMatchObject({ offsetX: 40, offsetY: 50, itemWidth: 84, itemHeight: 36 });
  expect(settings).toMatchObject({ autoHideRange: { start: .1 }, fontFamily: "Arial" });
  expect(settings.autoHideRange!.end).toBeCloseTo(.5);
  f.editor.destroy(); f.wrapper.remove();
});

it("keeps the range inside the bar with ordered boundaries and discards it on Cancel", () => {
  const f = fixture({ autoHide: "start", autoHideRange: { start: .2, end: .5 } });
  f.click(t("customize.hideRange"));
  const [start, end] = f.wrapper.querySelectorAll<HTMLElement>('[role="slider"]');
  for (let index = 0; index < 100; index++) {
    start!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  }
  // The boundaries may meet (a zero-width band) but the start never passes the end.
  expect(Number(start!.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(end!.getAttribute("aria-valuenow")));
  for (let index = 0; index < 200; index++) {
    start!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    end!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  }
  expect(start!.getAttribute("aria-valuenow")).toBe("0");
  expect(end!.getAttribute("aria-valuenow")).toBe("100");
  f.click(t("customize.cancel"));
  expect(f.canceled).toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.editor.destroy(); f.wrapper.remove();
});

it.each([
  ["column", "start"], ["column", "end"], ["row", "start"], ["row", "end"],
] as const)("cycles through range selection and collapsed sensing preview, saving the dragged reveal range (%s/%s)", async (orientation, autoHide) => {
  const range = { start: .1, end: .3 };
  const f = fixture({ orientation, autoHide, autoHideRange: range, autoHidePadding: 5 });
  const origin = { left: f.wrapper.style.left, top: f.wrapper.style.top };
  f.click(t("customize.hideRange"));
  f.click(t("customize.hideRange"));
  const handle = Array.from(f.wrapper.querySelectorAll<HTMLElement>('[role="slider"]')).find(handle => !handle.hidden)!;
  expect(handle.ariaLabel).toContain(t("customize.senseRange"));
  handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => false;
  const delta = autoHide === "start" ? 8 : -8;
  for (const [type, movement] of [["pointerdown", 0], ["pointermove", delta], ["pointerup", delta]] as const) {
    handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0,
      screenX: orientation === "column" ? movement : 0, screenY: orientation === "row" ? movement : 0 }));
  }
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.click(t("customize.senseRange"));
  expect(handle.closest<HTMLElement>(".hide-range-overlay")!.hidden).toBe(true);
  expect({ left: f.wrapper.style.left, top: f.wrapper.style.top }).toEqual(origin);
  f.click(t("bar.settings")); f.changeFont();
  f.click(t("customize.savePlacement")); await Promise.resolve();
  expect(f.saved).toHaveBeenCalledWith(
    expect.objectContaining({ offsetX: 40, offsetY: 50, itemWidth: 84, itemHeight: 36 }),
    expect.anything(),
    expect.objectContaining({ autoHideRange: range, autoHidePadding: 13, fontFamily: "Arial" }),
  );
  f.editor.destroy(); f.wrapper.remove();
});

it("bounds the sensing range within the bar and discards its draft on Cancel", () => {
  const f = fixture({ autoHide: "start", autoHideRange: { start: .2, end: .5 }, autoHidePadding: 5 });
  f.click(t("customize.hideRange")); f.click(t("customize.hideRange"));
  const handle = Array.from(f.wrapper.querySelectorAll<HTMLElement>('[role="slider"]')).find(handle => !handle.hidden)!;
  for (let index = 0; index < 200; index++) handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  const padding = Number(handle.getAttribute("aria-valuenow"));
  expect(padding).toBeGreaterThan(5);
  expect(padding).toBeLessThan(84);
  for (let index = 0; index < 200; index++) handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(handle.getAttribute("aria-valuenow")).toBe("0");
  f.click(t("customize.cancel"));
  expect(f.canceled).toHaveBeenCalled(); expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.editor.destroy(); f.wrapper.remove();
});
