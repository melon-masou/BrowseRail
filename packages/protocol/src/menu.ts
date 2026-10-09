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
/** Every menu has a default color; menus stored without one are filled with this. */
export const DEFAULT_MENU_COLOR = "#3d6cc2ff";

export type MenuOrientation = "row" | "column";
export type BarAutoHide = "off" | "start" | "end";
export interface BarAutoHideRange { start: number; end: number }
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

export type ItemIcon = { type: "lucide" | "phosphor"; name: string } | { type: "text"; text: string } | { type: "initial"; length?: 2 };
export type BarStyle = "text" | "textIcon" | "textColorIcon" | "icons" | "tiles";

export function normalizeItemIcon(value: unknown): ItemIcon | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.type === "initial") return raw.length === 2 ? { type: "initial", length: 2 } : { type: "initial" };
  if (raw.type === "text" && typeof raw.text === "string" && raw.text.trim()) return { type: "text", text: raw.text.trim() };
  if ((raw.type === "lucide" || raw.type === "phosphor") && typeof raw.name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.name)) return { type: raw.type, name: raw.name };
  return undefined;
}

export interface BookmarkEntry {
  kind: "bookmark";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
  uid: string;
  label: string;
  color?: MenuColor;
  rename?: string;
}

export interface MenuFoldEntry {
  kind: "menuFold";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface MenusToggleEntry {
  kind: "menusToggle";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface BrowserActionEntry {
  kind: "browserAction";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
  uid: string;
  label: string;
  color?: MenuColor;
}

export interface ShortcutsToggleEntry {
  kind: "shortcutsToggle";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
  uid: string;
  label: string;
  color?: MenuColor;
  on: boolean;
}

export interface AutoHideToggleEntry extends Omit<ShortcutsToggleEntry, "kind"> {
  kind: "autoHideToggle";
}

export interface FolderEntry {
  kind: "folder";
  cssClass?: string;
  icon?: ItemIcon;
  iconMask?: string;
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

export type LayoutEntry = BookmarkEntry | FolderEntry | MenuFoldEntry | MenusToggleEntry | BrowserActionEntry | ShortcutsToggleEntry | AutoHideToggleEntry;

/**
 * Render content for one menu: the item tree, appearance and runtime gates.
 * Spacing edits are submitted with placement
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
  globalCss?: Record<string, string>;
  cssClass?: string;
  uid: string;
  items: LayoutEntry[];
  orientation: MenuOrientation;
  style?: BarStyle;
  autoHide?: BarAutoHide;
  // Runtime gate; layout editing always uses the configured direction above.
  autoHideEnabled?: boolean;
  autoHidePadding?: number;
  autoHideRange?: BarAutoHideRange;
  fontFamily?: string;
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
