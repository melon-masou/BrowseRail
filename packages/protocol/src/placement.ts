// Where a menu surface sits and how it attaches to browser windows. Shared by stored bar
// configurations and the native wire protocol.

export type MenuAnchor = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * How a bound menu attaches to browser windows. This is a single sum type on
 * purpose — `free` is mutually exclusive with `all` (a free menu is one shared
 * floating surface, so it cannot also be per-window "all"), so splitting it into
 * orthogonal position/focus-scope axes would make the illegal `free`+`all`
 * combination representable. `none` is intentionally absent: URL-driven hiding
 * is expressed by `MenuNativeProps.visible`, not by an attach mode.
 */
export type AttachmentMode = "lastFocused" | "all" | "free";

export type OnTopMode = "aboveBrowser" | "alwaysOnTop";

/** A bound menu's position relative to its owning browser window. */
export interface MenuBoundPosition {
  anchor: MenuAnchor;
  offsetX: number;
  offsetY: number;
}

/**
 * Everything the DESKTOP decides about a surface's geometry and echoes back to
 * the extension after a drag or resize. Kept separate from `MenuTarget` (which
 * is downlink-only) precisely because this round-trips: the desktop reports a
 * bare placement with no window/target context (see the `updateMenuLayout`
 * native message).
 *
 * Both modes' data coexist here because a menu switches between them; each mode
 * reads its own field:
 *   • bound → `boundPosition` (anchor + offsets against the owning window).
 *   • free  → `freePosition` (absolute logical screen coordinate).
 * `itemWidth`/`itemHeight` are shared by both modes — the per-item pixel size the
 * user set by resizing; the webview lays out its grid from them and native
 * derives the window size.
 */
export interface MenuPlacement {
  boundPosition: MenuBoundPosition;
  // Absolute logical screen position of a free (detached) surface. Undefined for
  // a free menu with no saved position yet, and unused while bound.
  freePosition?: { x: number; y: number };
  itemWidth?: number;
  itemHeight?: number;
}

export function isMenuPlacement(value: unknown): value is MenuPlacement {
  if (!isRecord(value) || !isRecord(value.boundPosition)) {
    return false;
  }
  const bound = value.boundPosition;
  return (
    (bound.anchor === "topLeft" ||
      bound.anchor === "topRight" ||
      bound.anchor === "bottomLeft" ||
      bound.anchor === "bottomRight") &&
    [bound.offsetX, bound.offsetY].every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
