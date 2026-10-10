// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { MenuView } from "@browserail/protocol";
import { barDimensions, barItemSize, barToggleOffset } from "../layout";
import { mountSpacingEditor } from "./spacing-editor";

function menu(orientation: "row" | "column" = "row"): MenuView {
  return {
    uid: "menu", orientation, gapRatio: 0.1, extraGaps: { first: 0.2, fold: 8 },
    items: [
      { kind: "bookmark", uid: "first", label: "First" },
      { kind: "bookmark", uid: "second", label: "Second" },
      { kind: "menuFold", uid: "fold", label: "Fold" },
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

it.each(["row", "column"] as const)("cycles %s gap editing through all gaps, one gap and off without changing button size or the original config", orientation => {
  const view = menu(orientation);
  const size = { width: 100, height: 40 };
  const rail = document.createElement("div");
  const button = document.createElement("button");
  document.body.append(rail, button);
  const changed = vi.fn();
  const editor = mountSpacingEditor(rail, view, size, button, changed);
  const handles = rail.querySelectorAll<HTMLElement>(".gap-handle");
  for (const handle of handles) {
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = () => false;
  }
  const handle = handles[0]!;
  const drag = (distance: number): void => {
    for (const [type, at] of [["pointerdown", 0], ["pointermove", distance], ["pointerup", distance]] as const) {
      handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0,
        screenX: orientation === "row" ? at : 0,
        screenY: orientation === "column" ? at : 0,
      }));
    }
  };
  const dimension = orientation === "row" ? size.width : size.height;
  const length = (): number => { const bar = barDimensions(editor.menu, editor.itemSize); return orientation === "row" ? bar.width : bar.height; };

  expect(handle.hidden).toBe(true);
  editor.cycle();
  expect(editor.mode).toBe("all");
  expect(button.getAttribute("aria-pressed")).toBe("true");
  const beforeAll = length();
  drag(dimension * 0.3);
  // A drag in all-gaps mode changes the bar length once, spread across every gap.
  expect(length() - beforeAll).toBeCloseTo(dimension * 0.3);
  expect(editor.spacing.gapRatio).toBeGreaterThan(0.1);
  expect(editor.spacing.extraGaps.first).toBeCloseTo(0.2);

  editor.cycle();
  expect(editor.mode).toBe("single");
  const globalRatio = editor.spacing.gapRatio;
  drag(dimension * 0.5);
  expect(editor.spacing.extraGaps.first).toBeCloseTo(0.7);
  expect(editor.spacing.gapRatio).toBe(globalRatio);
  handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(editor.spacing.extraGaps.first).toBeUndefined();
  drag(-dimension);
  expect(editor.spacing.extraGaps.first).toBeUndefined();
  expect(editor.itemSize).toEqual(size);
  expect(view.extraGaps!.first).toBe(0.2);

  editor.cycle();
  expect(editor.mode).toBe("off");
  expect(handle.hidden).toBe(true);
  expect(button.getAttribute("aria-pressed")).toBe("false");
  const calls = changed.mock.calls.length;
  drag(dimension);
  expect(changed).toHaveBeenCalledTimes(calls);

  editor.cycle();
  editor.setItemSize({ width: 200, height: 80 });
  expect(barItemSize(editor.menu, barDimensions(editor.menu, editor.itemSize))).toEqual(editor.itemSize);
  editor.destroy();
  drag(dimension);
  expect(changed).toHaveBeenCalledTimes(calls);
  rail.remove(); button.remove();
});
