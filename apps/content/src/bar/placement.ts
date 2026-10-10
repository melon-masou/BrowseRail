import type { BrowserMenuPlacement } from "@browserail/protocol/content";

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

type Size = { width: number; height: number };

/**
 * The position `placementPoint` computes, written against the anchored edges so the browser keeps it as the
 * viewport changes; mobile browsers move `bottom`-anchored elements together with their collapsing toolbar.
 * `full` is the expanded bar that must stay on screen; `shown` and `toggle` place a collapsed bar at its toggle.
 */
export function placementStyle(placement: BrowserMenuPlacement, full: Size, shown: Size, toggle: { x: number; y: number }) {
  const near = (offset: number, fullSize: number, shift: number) => `calc(max(0px, min(100% - ${fullSize}px, ${offset}px)) + ${shift}px)`;
  const far = (offset: number, fullSize: number, shift: number, shownSize: number) =>
    `calc(min(100%, max(${fullSize}px, ${fullSize + offset}px)) - ${shift + shownSize}px)`;
  const right = placement.anchor.endsWith("Right");
  const bottom = placement.anchor.startsWith("bottom");
  return {
    left: right ? "auto" : near(placement.offsetX, full.width, toggle.x),
    right: right ? far(placement.offsetX, full.width, toggle.x, shown.width) : "auto",
    top: bottom ? "auto" : near(placement.offsetY, full.height, toggle.y),
    bottom: bottom ? far(placement.offsetY, full.height, toggle.y, shown.height) : "auto",
  };
}
