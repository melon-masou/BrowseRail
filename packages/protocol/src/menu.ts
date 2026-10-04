// =============================================================================
// RENDER AXIS — what the extension/webview draws.
//
// Render content and appearance belong here; native placement, targeting and
// window behavior live in `./native`.
//
// A synced menu separates:
//   view      (here)      — items, colors, fonts and the receiving host's spacing.
//                           Edits round-trip into that host's config fields.
//   placement (./native)  — per-button size and host-specific position.
//   native    (./native)  — native-only window behavior: attach mode, on-top
//                           mode, and URL-driven visibility. The webview never
//                           reads these.
//   target    (./native)  — which browser window a bound menu follows, or that
//                           the menu is a free floating surface. Downlink only.
//
// =============================================================================

/** Configured colors include alpha as #rrggbbaa, shared by items and menu surfaces. */
export type MenuColor = string;
export const DEFAULT_DOCK_COLOR = "#161b24e0";

export type MenuOrientation = "row" | "column";
export type BarAutoHide = "off" | "start" | "end";
export const DEFAULT_AUTO_HIDE_PADDING = 6;

/**
 * A font size in px, or the sentinel `AUTO_FONT_SIZE` (-1) meaning "auto": the
 * button font follows the button's pixel height; the popup font follows the
 * resolved button font. The webview resolves both to concrete px at render
 * time, so native/geometry code never needs to interpret the sentinel.
 */
export type MenuFontSize = number;
export const AUTO_FONT_SIZE = -1 as const;
export function isAutoFontSize(value: unknown): boolean {
  return value === AUTO_FONT_SIZE;
}

export type ExpandDirection = "down" | "up" | "right" | "left";
export type ExpandAlignment = "edge" | "center";

export interface BookmarkEntry {
  kind: "bookmark";
  uid: string;
  label: string;
  color?: MenuColor;
  rename?: string;
}

export interface MenuFoldEntry {
  kind: "menuFold";
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface MenusToggleEntry {
  kind: "menusToggle";
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface BrowserActionEntry {
  kind: "browserAction";
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface FolderEntry {
  kind: "folder";
  uid: string;
  label: string;
  color?: MenuColor;
  children: LayoutEntry[];
  expandOnHover?: boolean;
  expandDirection?: ExpandDirection;
  rename?: string;
}

export interface MenuSpacing {
  gapRatio: number;
  extraGaps: Record<string, number>;
}

export const DEFAULT_MENU_GAP_RATIO = 0.11;

export function normalizeMenuSpacing(value: unknown): MenuSpacing {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const gapRatio = typeof raw.gapRatio === "number" && Number.isFinite(raw.gapRatio)
    ? Math.max(0, raw.gapRatio) : DEFAULT_MENU_GAP_RATIO;
  const extra = raw.extraGaps && typeof raw.extraGaps === "object" && !Array.isArray(raw.extraGaps)
    ? raw.extraGaps as Record<string, unknown> : {};
  const extraGaps = Object.fromEntries(Object.entries(extra).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
  ));
  return { gapRatio, extraGaps };
}

export function isMenuSpacing(value: unknown): value is MenuSpacing {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.gapRatio === "number" && Number.isFinite(raw.gapRatio) && raw.gapRatio >= 0
    && Boolean(raw.extraGaps && typeof raw.extraGaps === "object" && !Array.isArray(raw.extraGaps))
    && Object.values(raw.extraGaps as object).every(value => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export type LayoutEntry = (BookmarkEntry | FolderEntry | MenuFoldEntry | MenusToggleEntry | BrowserActionEntry) & {
  // Stable identity of the button occurrence, separate from its navigation action.
  layoutId?: string;
};

/**
 * Render content for one menu: the item tree plus its appearance. Everything
 * here lives in menu configuration; spacing edits are submitted with placement
 * and persisted separately for Native and browser modes by the extension.
 *
 * Spacing ratios are projected from the receiving host's configuration.
 * Hosts resolve them against the actual button size along the bar orientation.
 *
 * Deliberately excluded (all in ./native): anchor/offsets/position and item
 * pixel size (MenuPlacement — desktop-owned geometry), attachmentMode/
 * onTopMode/visible (MenuNativeProps — native behavior), and the target window.
 */
export interface MenuView {
  uid: string;
  items: LayoutEntry[];
  orientation: MenuOrientation;
  autoHide?: BarAutoHide;
  autoHidePadding?: number;
  color?: MenuColor;
  expandDirection?: ExpandDirection;
  expandAlignment?: ExpandAlignment;
  buttonFontSize?: MenuFontSize;
  popupFontSize?: MenuFontSize;
  gapRatio?: number;
  extraGaps?: Record<string, number>;
  // Dock strip (bar background) color, independent of `color` (the default item
  // color). When unset all hosts use the default dock surface.
  dockColor?: MenuColor;
}
