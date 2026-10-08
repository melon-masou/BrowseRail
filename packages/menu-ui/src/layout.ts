import { DEFAULT_MENU_GAP_RATIO, type MenuView } from "@browserail/protocol";
import type { Size } from "./types";

export function gapRatioAfter(menu: MenuView, index: number): number {
  if (index >= menu.items.length - 1) return 0;
  const id = menu.items[index]?.uid;
  const extra = id && menu.extraGaps && Object.hasOwn(menu.extraGaps, id) ? menu.extraGaps[id]! : 0;
  return (menu.gapRatio ?? DEFAULT_MENU_GAP_RATIO) + extra;
}

export function barLengthFactor(menu: MenuView): number {
  return Math.max(1, menu.items.length) + menu.items.reduce((sum, _, index) => sum + gapRatioAfter(menu, index), 0);
}

export function barDimensions(menu: MenuView, size: Size): Size {
  const factor = barLengthFactor(menu);
  return menu.orientation === "row"
    ? { width: factor * size.width, height: size.height }
    : { width: size.width, height: factor * size.height };
}

export function barItemSize(menu: MenuView, dimensions: Size): Size {
  const factor = barLengthFactor(menu);
  return menu.orientation === "row"
    ? { width: dimensions.width / factor, height: dimensions.height }
    : { width: dimensions.width, height: dimensions.height / factor };
}

export function barFrameInsets(menu: Pick<MenuView, "orientation">): { x: number; y: number } {
  return menu.orientation === "row" ? { x: 5, y: 1 } : { x: 1, y: 5 };
}

export function barSurfaceDimensions(menu: MenuView, size: Size, collapsed = false): Size {
  const content = collapsed ? size : barDimensions(menu, size);
  const frame = barFrameInsets(menu);
  return { width: content.width + 2 * frame.x, height: content.height + 2 * frame.y };
}

export function barOffsets(menu: MenuView, size: Size): number[] {
  const dimension = menu.orientation === "row" ? size.width : size.height;
  let offset = 0;
  return menu.items.map((_, index) => {
    const current = offset;
    offset += dimension * (1 + gapRatioAfter(menu, index));
    return current;
  });
}

export function barToggleOffset(menu: MenuView, size: Size): { x: number; y: number } {
  const index = menu.items.findIndex(entry => entry.kind === "menuFold");
  const offset = index < 0 ? 0 : barOffsets(menu, size)[index]!;
  return menu.orientation === "row" ? { x: offset, y: 0 } : { x: 0, y: offset };
}

export function applyBarLayout(rail: HTMLElement, menu: MenuView, size: Size): void {
  const row = menu.orientation === "row";
  const dimension = row ? size.width : size.height;
  const tracks: string[] = [];
  for (let index = 0; index < Math.max(1, menu.items.length); index++) {
    tracks.push(`${dimension}px`);
    if (index < menu.items.length - 1) tracks.push(`${dimension * gapRatioAfter(menu, index)}px`);
  }
  const total = barDimensions(menu, size);
  rail.dataset.orientation = menu.orientation;
  rail.style.setProperty("--config-bar-tracks", tracks.join(" "));
  rail.style.setProperty("--config-bar-width", `${total.width}px`);
  rail.style.setProperty("--config-bar-height", `${total.height}px`);
  rail.style.setProperty("--config-bar-item-width", `${size.width}px`);
  rail.querySelectorAll<HTMLElement>(":scope > .menu-button").forEach((button, index) => {
    button.style.gridColumn = row ? String(2 * index + 1) : "1";
    button.style.gridRow = row ? "1" : String(2 * index + 1);
  });
}
