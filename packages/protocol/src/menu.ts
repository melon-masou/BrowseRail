// =============================================================================
// RENDER AXIS — what the extension/webview draws.
//
// This module holds ONLY the types the menu surface renders from: the item
// tree and per-menu appearance (colors, fonts, gap, popup direction). It does
// NOT describe where a native window sits, how big each button is, which
// browser window a menu attaches to, or when it is shown — those live in
// `./native` (MenuPlacement / MenuNativeProps / MenuTarget).
//
// How a single synced menu is partitioned (see `SyncedMenu` in ./native):
//   view      (here)      — render content + appearance: items, orientation,
//                           colors, fonts, gap. Config-authored; only the
//                           extension's options page changes it, and it only
//                           ever flows downstream to the webview.
//   placement (./native)  — everything the DESKTOP decides and echoes back:
//                           anchor + offsets (or a free surface's absolute
//                           position) AND the per-item pixel size
//                           (itemWidth/itemHeight, set by a desktop resize).
//                           Round-trips extension⇄desktop.
//   native    (./native)  — native-only window behavior: attach mode, on-top
//                           mode, and URL-driven visibility. The webview never
//                           reads these.
//   target    (./native)  — which browser window a bound menu follows, or that
//                           the menu is a free floating surface. Downlink only.
//
// The item pixel size lives in `placement` (not here) because the desktop owns
// it — the user resizes a surface and the new dimensions are reported back.
// The webview still reads those dimensions to lay out its grid, and native
// reads them to size the window; but authorship is the desktop's, so the field
// sits with the rest of the desktop-owned geometry.
//
// Rule of thumb for future edits: config-authored appearance the webview draws
// → `view` (this file). Anything the desktop positions, sizes-as-a-window, or
// gates → `./native`. Do not re-merge the axes: keeping them apart is what lets
// the desktop echo a placement back without dragging render content along, and
// lets the webview render without knowing anything about native targeting.
// =============================================================================

export type MenuOrientation = "row" | "column";
export type MenuFontSize = number;
export type ExpandDirection = "down" | "up" | "right" | "left";

export interface BookmarkEntry {
  kind: "bookmark";
  uid: string;
  label: string;
  color?: string;
  rename?: string;
}

export interface MenuToggleEntry {
  kind: "menuToggle";
  uid: string;
  label: string;
}

export interface FolderEntry {
  kind: "folder";
  uid: string;
  label: string;
  color?: string;
  children: LayoutEntry[];
  expandOnHover?: boolean;
  expandDirection?: ExpandDirection;
  rename?: string;
}

export interface SpaceEntry {
  kind: "space";
  uid: string;
  units?: number;
  color?: string;
  transparent?: boolean;
}

export type LayoutEntry = BookmarkEntry | FolderEntry | MenuToggleEntry | SpaceEntry;

/**
 * Render content for one menu: the item tree plus its appearance. Everything
 * here is authored by the extension's config (options page) and only flows
 * downstream to the webview — it never round-trips from the desktop.
 *
 * `gap` is the inter-item spacing (px), resolved by the extension from the
 * menu's gap percentage; it is config-owned appearance, so it lives here rather
 * than in the desktop-owned `MenuPlacement`. Native reads it (together with the
 * item size in `MenuPlacement`) when deriving the total window size.
 *
 * Deliberately excluded (all in ./native): anchor/offsets/position and item
 * pixel size (MenuPlacement — desktop-owned geometry), attachmentMode/
 * onTopMode/visible (MenuNativeProps — native behavior), and the target window.
 */
export interface MenuView {
  uid: string;
  items: LayoutEntry[];
  orientation: MenuOrientation;
  color?: string;
  expandDirection?: ExpandDirection;
  buttonFontSize?: MenuFontSize;
  popupFontSize?: MenuFontSize;
  gap?: number;
}
