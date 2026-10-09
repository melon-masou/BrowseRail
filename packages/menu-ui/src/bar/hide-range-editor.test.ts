// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { mountHideRangeEditor } from "./hide-range-editor";

it("lets the visible band shrink to zero without allowing the hover trigger to disappear", () => {
  const rail = document.createElement("div");
  const button = document.createElement("button");
  const changed = vi.fn();
  const editor = mountHideRangeEditor(rail, {
    uid: "bar", items: [], orientation: "column", autoHide: "end",
    autoHideRange: { start: .25, end: .5 }, autoHidePadding: 0,
  }, { width: 84, height: 36 }, button, changed);
  try {
    editor.cycle();
    const start = rail.querySelector<HTMLElement>('[data-boundary="start"]')!;
    for (let n = 0; n < 30; n++) start.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(changed).toHaveBeenLastCalledWith({ autoHideRange: { start: .5, end: .5 } });
    editor.cycle();
    expect(start.hidden).toBe(false);
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const patch = changed.mock.lastCall![0];
    expect(patch.autoHidePadding).toBeGreaterThan(0);
    expect(Number(start.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  } finally { editor.destroy(); }
});

it.each([0, 1])("can reopen a zero-width band at edge %s using its visible handle", position => {
  const rail = document.createElement("div");
  const changed = vi.fn();
  const editor = mountHideRangeEditor(rail, {
    uid: "bar", items: [], orientation: "column", autoHide: "end",
    autoHideRange: { start: position, end: position },
  }, { width: 84, height: 36 }, document.createElement("button"), changed);
  try {
    editor.cycle();
    const handles = [...rail.querySelectorAll<HTMLElement>('[role="slider"]')].filter(handle => !handle.hidden);
    expect(handles).toHaveLength(1);
    handles[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: position === 0 ? "ArrowRight" : "ArrowLeft", bubbles: true }));
    const range = changed.mock.lastCall![0].autoHideRange;
    expect(range.end).toBeGreaterThan(range.start);
  } finally { editor.destroy(); }
});
