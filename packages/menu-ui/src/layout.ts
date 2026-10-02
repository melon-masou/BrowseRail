import type { ExpandDirection, LayoutEntry } from "@browserail/protocol";
import type { Lifetime } from "./lifetime";
import type { PopupRequest, PopupState, Rect } from "./types";

export const POPUP_SCREEN_MARGIN = 4;
const MIN_COLUMN_WIDTH = 72;
const BASE_MAX_COLUMN_WIDTH = 420;
const BASE_POPUP_FONT_SIZE = 13;
const MAX_SUBMENU_VISIBLE_ITEMS = 12;

export function submenuHeightLimit(itemHeight: number): number {
  return 12 + MAX_SUBMENU_VISIBLE_ITEMS * (itemHeight + 2);
}

function columnContentHeight(count: number, itemHeight: number): number {
  return 14 + count * itemHeight + Math.max(0, count - 1) * 2;
}

export function planFolderPopup(
  measure: (text: string, fontSize: number) => number, request: PopupRequest, available: Rect,
): { surface: Rect; state: PopupState } {
  const bounds = {
    left: available.left + POPUP_SCREEN_MARGIN, top: available.top + POPUP_SCREEN_MARGIN,
    right: available.right - POPUP_SCREEN_MARGIN, bottom: available.bottom - POPUP_SCREEN_MARGIN,
  };
  const { anchor, theme } = request;
  const width = Math.max(1, bounds.right - bounds.left);
  const below = Math.max(1, bounds.bottom - Math.max(bounds.top, anchor.bottom));
  const above = Math.max(1, Math.min(bounds.bottom, anchor.top) - bounds.top);
  let direction = request.direction;
  if (direction === "down" && below < Math.min(120, above)) direction = "up";
  else if (direction === "up" && above < Math.min(120, below)) direction = "down";
  const sideways = direction === "left" || direction === "right";
  const limit = submenuHeightLimit(theme.itemHeight);
  const contentHeight = columnContentHeight(request.folder.children.filter(entry => entry.kind === "folder" || entry.kind === "bookmark").length, theme.itemHeight);
  const beside = Math.max(1, bounds.bottom - Math.max(bounds.top, anchor.top));
  const maxColumnHeight = direction === "up" ? above : direction === "down" ? below
    : contentHeight > beside ? Math.min(bounds.bottom - bounds.top, limit) : beside;
  const columnWidth = Math.min(width, calculateColumnWidth(measure, request.folder.children, theme.fontSize, maxColumnHeight, theme.itemHeight));
  let rootDirection = direction;
  let x = anchor.left;
  if (sideways) {
    if ((direction === "left" ? anchor.left - bounds.left : bounds.right - anchor.right) < columnWidth) {
      rootDirection = direction === "left" ? "right" : "left";
    }
    x = rootDirection === "left" ? anchor.left - columnWidth : anchor.right;
  }
  x = Math.max(bounds.left, Math.min(x, bounds.right - columnWidth));
  const y = Math.max(bounds.top, Math.min(direction === "down" ? anchor.bottom : anchor.top,
    sideways ? bounds.bottom - Math.min(contentHeight, maxColumnHeight) : bounds.bottom));
  const envelope = popupEnvelope(measure, request.folder.children, theme.fontSize, theme.itemHeight, Math.min(maxColumnHeight, limit), direction);
  const hasChildren = request.folder.children.some(entry => entry.kind === "folder");
  const reserve = hasChildren ? Math.max(0, envelope.width - columnWidth) : 0;
  const firstHeight = Math.min(contentHeight, maxColumnHeight);
  // Reserve child movement before mounting, so opening another level keeps the anchor fixed.
  const top = direction === "up" ? hasChildren ? bounds.top : y - firstHeight
    : hasChildren ? Math.max(bounds.top, y - limit) : y;
  const bottom = direction === "up" ? hasChildren ? Math.min(bounds.bottom, y + limit) : y
    : hasChildren ? bounds.bottom : y + firstHeight;
  const surface = {
    left: Math.max(bounds.left, x - reserve), right: Math.min(bounds.right, x + columnWidth + reserve),
    top, bottom,
  };
  return { surface, state: {
    entries: request.folder.children, theme, direction, rootDirection,
    rootOffsetX: x - surface.left, rootOffsetY: y - surface.top,
    bounds: { left: 0, top: 0, right: surface.right - surface.left, bottom: surface.bottom - surface.top },
    maxColumnHeight, editingLocked: request.editingLocked,
  } };
}

export function createTextMeasure(root: HTMLElement, lifetime: Lifetime): (text: string, fontSize: number) => number {
  const span = root.ownerDocument.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.className = "menu-text-measure";
  root.append(span);
  lifetime.onDestroy(() => span.remove());
  return (text, fontSize) => {
    // Renderers replace their content; the measurement node belongs to this mount.
    if (!span.isConnected) root.append(span);
    span.style.fontSize = `${fontSize}px`;
    span.textContent = text;
    return span.getBoundingClientRect().width;
  };
}

export function calculateColumnWidth(
  measure: (text: string, fontSize: number) => number,
  entries: LayoutEntry[], fontSize: number, maxColumnHeight: number,
  itemHeight = Math.max(24, Math.round(fontSize * 2.7)),
): number {
  if (entries.length === 0) return MIN_COLUMN_WIDTH;
  const paddingPerSide = Math.min(10, Math.max(4, fontSize * 0.75));
  const folderBlock = Math.min(8, Math.max(6, fontSize * 0.5));
  const visible = entries.filter(entry => entry.kind === "bookmark" || entry.kind === "folder");
  let width = 0;
  for (const entry of visible) {
    if (entry.kind !== "bookmark" && entry.kind !== "folder") continue;
    const text = entry.rename && entry.rename !== entry.label && !entry.label.startsWith(entry.rename)
      ? `${entry.rename} (${entry.label})` : entry.label;
    width = Math.max(width, measure(text, fontSize) + paddingPerSide * 2 + (entry.kind === "folder" ? folderBlock : 0));
  }
  const contentHeight = columnContentHeight(visible.length, itemHeight);
  return Math.min(Math.round(BASE_MAX_COLUMN_WIDTH * Math.max(1, fontSize / BASE_POPUP_FONT_SIZE)),
    Math.max(MIN_COLUMN_WIDTH, Math.ceil(width + 20) + (contentHeight > maxColumnHeight ? 18 : 0)));
}

export function popupEnvelope(
  measure: (text: string, fontSize: number) => number,
  entries: LayoutEntry[], fontSize: number, itemHeight: number,
  maxColumnHeight: number, direction: ExpandDirection,
): { width: number; height: number } {
  const width = calculateColumnWidth(measure, entries, fontSize, maxColumnHeight, itemHeight);
  const visible = entries.filter(entry => entry.kind === "bookmark" || entry.kind === "folder");
  const height = Math.min(maxColumnHeight, columnContentHeight(visible.length, itemHeight));
  let childWidth = 0;
  let childHeight = 0;
  for (const entry of visible) {
    if (entry.kind !== "folder") continue;
    const child = popupEnvelope(measure, entry.children, fontSize, itemHeight, maxColumnHeight, direction);
    childWidth = Math.max(childWidth, child.width);
    childHeight = Math.max(childHeight, child.height);
  }
  return { width: width + childWidth, height: direction === "up" ? Math.max(height, childHeight) : childWidth > 0 ? maxColumnHeight : height };
}
