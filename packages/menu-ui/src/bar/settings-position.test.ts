import { expect, it } from "vitest";
import { placeBarSettings } from "./settings-position";
import type { Rect } from "../types";

const bounds: Rect = { left: 0, top: 0, right: 1200, bottom: 900 };
const size = { width: 350, height: 400 };

it.each([
  [{ left: 100, right: 200, top: 100, bottom: 700 }, "right"],
  [{ left: 850, right: 950, top: 100, bottom: 700 }, "left"],
] as const)("places vertical bar settings on the larger %s side without covering the bar", (anchor, side) => {
  const position = placeBarSettings(anchor, size, bounds, "column");
  if (side === "right") expect(position.x).toBeGreaterThanOrEqual(anchor.right);
  else expect(position.x + size.width).toBeLessThanOrEqual(anchor.left);
});

it.each([
  [{ left: 200, right: 1000, top: 100, bottom: 150 }, "below"],
  [{ left: 200, right: 1000, top: 700, bottom: 750 }, "above"],
] as const)("places horizontal bar settings on the larger %s side without covering the bar", (anchor, side) => {
  const position = placeBarSettings(anchor, size, bounds, "row");
  if (side === "below") expect(position.y).toBeGreaterThanOrEqual(anchor.bottom);
  else expect(position.y + size.height).toBeLessThanOrEqual(anchor.top);
});

it("keeps settings visible near a work area edge with a negative desktop origin", () => {
  const workArea = { left: -1200, top: -900, right: 0, bottom: 0 };
  const anchor = { left: -500, right: -400, top: -60, bottom: -10 };
  for (const orientation of ["column", "row"] as const) {
    const position = placeBarSettings(anchor, size, workArea, orientation);
    expect(position.x).toBeGreaterThanOrEqual(workArea.left);
    expect(position.y).toBeGreaterThanOrEqual(workArea.top);
    expect(position.x + size.width).toBeLessThanOrEqual(workArea.right);
    expect(position.y + size.height).toBeLessThanOrEqual(workArea.bottom);
  }
});
