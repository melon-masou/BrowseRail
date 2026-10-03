// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { MenuView } from "@browserail/protocol";
import { barDimensions, barItemSize, barToggleOffset } from "../layout";
import { mountSpacingEditor } from "./spacing-editor";

function menu(orientation: "row" | "column" = "row"): MenuView {
  return {
    uid: "menu", orientation, gapRatio: 0.1, extraGaps: { first: 0.2, fold: 8 },
    items: [
      { kind: "bookmark", uid: "bookmark:first", layoutId: "first", label: "First" },
      { kind: "bookmark", uid: "bookmark:second", layoutId: "second", label: "Second" },
      { kind: "menuFold", uid: "fold", layoutId: "fold", label: "Fold" },
    ],
  };
}

it("scales gaps along the button axis, follows reordered buttons, and keeps the fold button in place", () => {
  const view = menu();
  const size = { width: 100, height: 40 };
  expect(barDimensions(view, size)).toEqual({ width: 340, height: 40 });
  expect(barItemSize(view, barDimensions(view, size))).toEqual(size);
  expect(barToggleOffset(view, size)).toEqual({ x: 240, y: 0 });
  view.orientation = "column";
  expect(barDimensions(view, size)).toEqual({ width: 100, height: 136 });
  expect(barToggleOffset(view, size)).toEqual({ x: 0, y: 96 });
  // Moving the last item to the front makes its retained extra gap active.
  view.items = [view.items[2]!, view.items[1]!, view.items[0]!];
  expect(barDimensions(view, size)).toEqual({ width: 100, height: 448 });
});

it.each(["row", "column"] as const)("edits %s gaps without changing button size or the original config, and stops on destruction", orientation => {
  const view = menu(orientation);
  const size = { width: 100, height: 40 };
  const rail = document.createElement("div");
  document.body.append(rail);
  const changed = vi.fn();
  const editor = mountSpacingEditor(rail, view, size, changed);
  editor.setEnabled(true);
  const handles = rail.querySelectorAll<HTMLElement>(".gap-handle");
  for (const handle of handles) {
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => false;
  }
  const handle = handles[0]!;
  const pointer = (type: string, button: number, distance: number): void => {
    handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, button,
      screenX: orientation === "row" ? distance : 0,
      screenY: orientation === "column" ? distance : 0,
    }));
  };
  const dimension = orientation === "row" ? size.width : size.height;
  pointer("pointerdown", 0, 0);
  pointer("pointermove", 0, dimension * 0.5);
  pointer("pointerup", 0, dimension * 0.5);
  expect(editor.spacing.gapRatio).toBe(0.1);
  expect(editor.spacing.extraGaps.first).toBeCloseTo(0.7);
  expect(editor.itemSize).toEqual(size);
  expect(view.extraGaps!.first).toBe(0.2);
  const beforeGlobal = barDimensions(editor.menu, editor.itemSize);
  pointer("pointerdown", 2, 0);
  pointer("pointermove", 2, dimension * 0.3);
  pointer("pointerup", 2, dimension * 0.3);
  const afterGlobal = barDimensions(editor.menu, editor.itemSize);
  expect(orientation === "row" ? afterGlobal.width - beforeGlobal.width : afterGlobal.height - beforeGlobal.height)
    .toBeCloseTo(dimension * 0.3);
  expect(editor.spacing.gapRatio).toBeGreaterThan(0.1);
  expect(editor.spacing.extraGaps.first).toBeCloseTo(0.7);
  const globalRatio = editor.spacing.gapRatio;
  handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(editor.spacing.extraGaps.first).toBeUndefined();
  expect(editor.spacing.gapRatio).toBe(globalRatio);
  pointer("pointerdown", 0, 0);
  pointer("pointermove", 0, -dimension);
  expect(editor.spacing.extraGaps.first).toBeUndefined();
  pointer("pointerup", 0, -dimension);
  editor.setItemSize({ width: 200, height: 80 });
  expect(barItemSize(editor.menu, barDimensions(editor.menu, editor.itemSize))).toEqual(editor.itemSize);
  pointer("pointerdown", 2, 0);
  pointer("pointermove", 2, -1000);
  expect(editor.spacing.gapRatio).toBe(0);
  editor.destroy();
  const calls = changed.mock.calls.length;
  pointer("pointermove", 2, 1000);
  expect(changed).toHaveBeenCalledTimes(calls);
  rail.remove();
});
