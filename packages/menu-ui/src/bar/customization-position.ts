import type { Rect, Size } from "../types";

export type ToolbarSide = "top" | "bottom" | "left" | "right";

export function placeCustomizationToolbar(anchor: Rect, size: Size, bounds: Rect, current?: ToolbarSide, gap = 4) {
  const clampX = (x: number): number => Math.max(bounds.left, Math.min(x, bounds.right - size.width));
  const clampY = (y: number): number => Math.max(bounds.top, Math.min(y, bounds.bottom - size.height));
  const centerX = clampX((anchor.left + anchor.right - size.width) / 2);
  const centerY = clampY((anchor.top + anchor.bottom - size.height) / 2);
  const candidates = [
    { side: "bottom", x: centerX, y: anchor.bottom + gap },
    { side: "top", x: centerX, y: anchor.top - gap - size.height },
    { side: "right", x: anchor.right + gap, y: centerY },
    { side: "left", x: anchor.left - gap - size.width, y: centerY },
  ] satisfies { side: ToolbarSide; x: number; y: number }[];
  const fits = (p: { x: number; y: number }): boolean => p.x >= bounds.left && p.y >= bounds.top
    && p.x + size.width <= bounds.right && p.y + size.height <= bounds.bottom;
  const previous = candidates.find(p => p.side === current);
  let position = previous && fits(previous) ? previous : candidates.find(fits);
  if (!position) {
    // Even a bar occupying the entire work area must leave Save/Cancel reachable.
    const clamped = candidates.map(p => ({ ...p, x: clampX(p.x), y: clampY(p.y) }));
    const overlap = (p: { x: number; y: number }): number => Math.max(0, Math.min(anchor.right, p.x + size.width) - Math.max(anchor.left, p.x))
      * Math.max(0, Math.min(anchor.bottom, p.y + size.height) - Math.max(anchor.top, p.y));
    const preferred = clamped.find(p => p.side === current) ?? clamped[0]!;
    position = clamped.reduce((best, p) => overlap(p) < overlap(best) ? p : best, preferred);
  }
  return {
    ...position,
    bounds: {
      left: Math.min(anchor.left, position.x), top: Math.min(anchor.top, position.y),
      right: Math.max(anchor.right, position.x + size.width), bottom: Math.max(anchor.bottom, position.y + size.height),
    },
  };
}
