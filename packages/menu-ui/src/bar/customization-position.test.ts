import { expect, it } from "vitest";
import type { Rect } from "../types";
import { placeCustomizationToolbar } from "./customization-position";

const toolbar = { width: 100, height: 50 };
const workArea = { left: 0, top: 0, right: 1200, bottom: 850 };

function expectVisible(position: { x: number; y: number }, bounds = workArea): void {
  expect(position.x).toBeGreaterThanOrEqual(bounds.left);
  expect(position.y).toBeGreaterThanOrEqual(bounds.top);
  expect(position.x + toolbar.width).toBeLessThanOrEqual(bounds.right);
  expect(position.y + toolbar.height).toBeLessThanOrEqual(bounds.bottom);
}

it("moves a toolbar above a bar when the taskbar occupies the bottom of the screen", () => {
  const anchor = { left: 300, top: 780, right: 400, bottom: 825 };
  const position = placeCustomizationToolbar(anchor, toolbar, workArea, "bottom");
  expect(position.y + toolbar.height).toBeLessThanOrEqual(anchor.top);
  expectVisible(position);
});

it.each([
  { left: 0, top: 0, right: 100, bottom: 850 },
  { left: 1100, top: 0, right: 1200, bottom: 850 },
])("places the editor beside a bar occupying the full height", (anchor: Rect) => {
  const position = placeCustomizationToolbar(anchor, toolbar, workArea);
  expect(position.x >= anchor.right || position.x + toolbar.width <= anchor.left).toBe(true);
  expectVisible(position);
});

it.each([
  { left: 0, top: 0, right: 1200, bottom: 50 },
  { left: 0, top: 800, right: 1200, bottom: 850 },
])("places the editor above or below a bar occupying the full width", (anchor: Rect) => {
  const position = placeCustomizationToolbar(anchor, toolbar, workArea, "right");
  expect(position.y >= anchor.bottom || position.y + toolbar.height <= anchor.top).toBe(true);
  expectVisible(position);
});

it("keeps the current side while it fits, and keeps controls visible at a corner of a negative-origin work area", () => {
  const bounds = { left: -1200, top: -900, right: 0, bottom: -50 };
  const anchor = { left: -1200, top: -180, right: -1160, bottom: -50 };
  const position = placeCustomizationToolbar(anchor, toolbar, bounds, "right");
  expect(position.side).toBe("right");
  expect(position.x).toBeGreaterThanOrEqual(anchor.right);
  expectVisible(position, bounds);
});

it("keeps controls visible even when a bar leaves no room on any side", () => {
  const position = placeCustomizationToolbar(workArea, toolbar, workArea);
  expectVisible(position);
});
