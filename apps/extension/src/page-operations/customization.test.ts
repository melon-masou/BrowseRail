// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { t } from "@browserail/i18n";
import { defaultBarSettings, type MenuView } from "@browserail/protocol";
import { mountBrowserCustomization } from "./customization";

function fixture() {
  const wrapper = document.createElement("div");
  const root = document.createElement("div"); wrapper.append(root); document.body.append(wrapper);
  const menu: MenuView = { ...defaultBarSettings(), uid: "bar", items: [
    { kind: "bookmark", uid: "bookmark:a", layoutId: "a", label: "A" },
    { kind: "bookmark", uid: "bookmark:b", layoutId: "b", label: "B" },
  ] };
  const initial = structuredClone(menu);
  const saved = vi.fn(async () => {});
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
    input.value = "Arial"; input.dispatchEvent(new Event("change", { bubbles: true }));
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
    [],
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

it("saves the selected settings groups with the final draft, without applying them before Save", async () => {
  const f = fixture(); f.changeOrientation();
  const section = [...f.wrapper.querySelectorAll("section")].find(section => section.querySelector("strong")?.textContent === t("bar.autoHide"))!;
  section.querySelector("button")!.click();
  const select = section.querySelector("select")!;
  select.value = "end"; select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(f.saved).not.toHaveBeenCalled();
  expect(f.menu).toEqual(f.initial);
  f.click(t("customize.savePlacement"));
  await Promise.resolve();
  expect(f.saved).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ autoHide: "end" }), ["autoHide"]);
  f.editor.destroy(); f.wrapper.remove();
});
