import type { MenuView } from "@browserail/protocol";
import type { Rect, Size } from "../types";

export function placeBarSettings(anchor: Rect, size: Size, bounds: Rect, orientation: MenuView["orientation"], gap = 8): { x: number; y: number } {
  let x = anchor.left;
  let y = anchor.top;
  if (orientation === "column") {
    const left = anchor.left - bounds.left;
    const right = bounds.right - anchor.right;
    x = right >= left ? anchor.right + gap : anchor.left - gap - size.width;
  } else {
    const above = anchor.top - bounds.top;
    const below = bounds.bottom - anchor.bottom;
    y = below >= above ? anchor.bottom + gap : anchor.top - gap - size.height;
  }
  return {
    x: Math.max(bounds.left, Math.min(x, bounds.right - size.width)),
    y: Math.max(bounds.top, Math.min(y, bounds.bottom - size.height)),
  };
}
