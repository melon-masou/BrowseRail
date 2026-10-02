import type { BrowserMenuPlacement } from "../config";

export function placementPoint(placement: BrowserMenuPlacement, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const right = placement.anchor.endsWith("Right");
  const bottom = placement.anchor.startsWith("bottom");
  return {
    x: Math.max(0, Math.min(viewportWidth - width, right ? viewportWidth - width - placement.offsetX : placement.offsetX)),
    y: Math.max(0, Math.min(viewportHeight - height, bottom ? viewportHeight - height - placement.offsetY : placement.offsetY)),
  };
}

export function placementAtPoint(placement: BrowserMenuPlacement, x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number): BrowserMenuPlacement {
  return {
    ...placement,
    offsetX: placement.anchor.endsWith("Right") ? viewportWidth - width - x : x,
    offsetY: placement.anchor.startsWith("bottom") ? viewportHeight - height - y : y,
  };
}
