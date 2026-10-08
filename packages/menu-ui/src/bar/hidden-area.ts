import { DEFAULT_AUTO_HIDE_PADDING, type BarAutoHideRange, type MenuView } from "@browserail/protocol";
import { barFrameInsets, barSurfaceDimensions } from "../layout";
import type { Rect, Size } from "../types";

const PEEK_SIZE = 6;

export function barHiddenRange(menu: MenuView, itemSize: Size): BarAutoHideRange {
  if (menu.autoHideRange) return { ...menu.autoHideRange };
  const surface = barSurfaceDimensions(menu, itemSize);
  const extent = menu.orientation === "column" ? surface.width : surface.height;
  const fraction = Math.min(1, PEEK_SIZE / extent);
  return menu.autoHide === "end" ? { start: 0, end: fraction } : { start: 1 - fraction, end: 1 };
}

export function barHiddenArea(menu: MenuView, itemSize: Size) {
  const surface = barSurfaceDimensions(menu, itemSize);
  const horizontal = menu.orientation === "column";
  const extent = horizontal ? surface.width : surface.height;
  const range = barHiddenRange(menu, itemSize);
  const bandStart = range.start * extent;
  const bandSize = (range.end - range.start) * extent;
  const start = menu.autoHide === "end" ? extent - bandSize : 0;
  const end = start + bandSize;
  const distance = start - bandStart;
  const padding = menu.autoHidePadding ?? DEFAULT_AUTO_HIDE_PADDING;
  const visible: Rect = horizontal
    ? { left: start, top: 0, right: end, bottom: surface.height }
    : { left: 0, top: start, right: surface.width, bottom: end };
  const hit: Rect = horizontal
    ? { ...visible, left: Math.max(0, start - padding), right: Math.min(extent, end + padding) }
    : { ...visible, top: Math.max(0, start - padding), bottom: Math.min(extent, end + padding) };
  return { surface, visible, hit, offset: { x: horizontal ? distance : 0, y: horizontal ? 0 : distance } };
}

export function applyBarHiddenAppearance(rail: HTMLElement, menu: MenuView, itemSize: Size, hidden: boolean): void {
  const { visible, offset } = barHiddenArea(menu, itemSize);
  const frame = barFrameInsets(menu);
  const column = menu.orientation === "column";
  const start = column ? visible.left - offset.x : visible.top - offset.y;
  const size = column ? visible.right - visible.left : visible.bottom - visible.top;
  rail.toggleAttribute("data-auto-hidden", hidden);
  rail.dataset.autoHide = menu.autoHide ?? "off";
  rail.style.setProperty("--bar-hidden-start", `${start}px`);
  rail.style.setProperty("--bar-hidden-size", `${size}px`);
  rail.style.setProperty("--bar-hidden-center-x", column ? `${start + size / 2 - frame.x}px` : "50%");
  rail.style.setProperty("--bar-hidden-center-y", column ? "50%" : `${start + size / 2 - frame.y}px`);
}
