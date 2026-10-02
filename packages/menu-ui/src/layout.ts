import type { ExpandDirection, LayoutEntry } from "@browserail/protocol";
import type { Lifetime } from "./lifetime";

export const MIN_COLUMN_HEIGHT = 48;
export const POPUP_SCREEN_MARGIN = 4;
const MIN_COLUMN_WIDTH = 72;
const BASE_MAX_COLUMN_WIDTH = 420;
const BASE_POPUP_FONT_SIZE = 13;

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
  const contentHeight = 14 + visible.length * itemHeight + Math.max(0, visible.length - 1) * 2;
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
  const height = Math.min(maxColumnHeight, 14 + visible.length * itemHeight + Math.max(0, visible.length - 1) * 2);
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
