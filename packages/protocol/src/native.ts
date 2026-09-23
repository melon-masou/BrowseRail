// =============================================================================
// NATIVE AXIS — how the desktop (Tauri/Rust) places, sizes, gates and targets a
// menu surface, plus the extension⇄native wire messages.
//
// Nothing here is drawn by the webview. The render content it draws lives in
// `./menu` (MenuView). A single synced menu is split across four fields (see
// `SyncedMenu`), along two independent concerns:
//   • WHERE/HOW-BIG the surface is        → MenuPlacement (desktop-owned, round-trips)
//   • WHICH window / free                 → MenuTarget    (downlink only)
//   • native window behavior + visibility → MenuNativeProps
//   • what to render                      → MenuView (in ./menu)
//
// Positioning (bound vs free) and URL visibility are deliberately separate axes:
// `target` says where a surface lives, `native.visible` says whether it shows
// for the current URL. Both bound and free menus honor `visible` the same way
// (hidden-but-kept), so switching URLs never destroys and recreates a surface.
// =============================================================================

import type { MenuView } from "./menu";

export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PORT = 17654 as const;
export const DEFAULT_WS_URL = "ws://127.0.0.1:17654" as const;
export const DEFAULT_HTTP_URL = "http://127.0.0.1:17654" as const;
export const SOCKET_URL = DEFAULT_WS_URL;

/**
 * A best-effort browser identifier for display only (e.g. "chrome", "edge").
 * Intentionally an open string, not a closed union: the extension reports
 * whatever it detects and falls back to a default, so native never enumerates or
 * validates the value — it is not used for identity or window matching (that is
 * `uid` + window pairing).
 */
export type BrowserKind = string;

/**
 * Identity of one connected browser (one extension connection). `uid` is the
 * key everything else hangs off (sessions, per-window menu registry). `label`
 * is a human-readable name shown in the desktop tray status line; when empty the
 * tray falls back to the uid. `browser` is display-only (see BrowserKind).
 */
export interface BrowserInstance {
  uid: string;
  browser?: BrowserKind;
  label?: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A browser window's screen rectangle, reported BY the extension — the only
 * side that holds the `browser.windows` API. It is consumed by native to place
 * a bound menu relative to its owning window; it never reaches the webview
 * (that is why it sits under `MenuTarget`, not `MenuView`).
 */
export interface BrowserWindowSnapshot {
  uid: string;
  bounds: WindowBounds;
  focused?: boolean;
}

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
 * bare placement with no window/target context (see the `updateMenuPlacement`
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

/**
 * Native-only window behavior for one menu; the webview never reads these.
 *   • attachmentMode / onTopMode — window attach + z-order behavior.
 *   • visible — URL-driven show/hide. When false the native surface is kept
 *     alive but hidden (avoiding destroy/recreate flicker as the URL changes),
 *     for BOTH bound and free menus.
 */
export interface MenuNativeProps {
  attachmentMode: AttachmentMode;
  onTopMode: OnTopMode;
  visible: boolean;
}

/**
 * Where a menu surface lives. Downlink only — native never sends this back
 * (geometry it changes goes through `MenuPlacement`). A free surface's absolute
 * position is NOT here; it lives in `MenuPlacement.position` so the whole
 * placement can round-trip as one unit.
 */
export type MenuTarget =
  | { kind: "window"; window: BrowserWindowSnapshot }
  | {
      kind: "free";
      // The reference window is used only to center a new free surface. It never becomes its owner.
      referenceWindow?: BrowserWindowSnapshot;
    };

/**
 * One menu as synced from extension to native, split along the render/native
 * axes documented at the top of this file and in `./menu`.
 */
export interface SyncedMenu {
  view: MenuView;
  placement: MenuPlacement;
  native: MenuNativeProps;
  target: MenuTarget;
}

export type ExtensionMessage =
  | {
      type: "hello";
      protocolVersion: typeof PROTOCOL_VERSION;
      instance: BrowserInstance;
    }
  | {
      type: "sync";
      revision: number;
      // Bound and free menus share one collection. Each entry's target explicitly identifies
      // which kind it is without maintaining two competing representations.
      menus: SyncedMenu[];
      // Menu placements cleared by a user reset. This tells the desktop that an
      // already-open free surface should move back to its unsaved default spot;
      // ordinary syncs must preserve that window's current position.
      resetMenuUids?: string[];
    }
  | { type: "pairWindow"; requestUid: string; windowUid: string }
  | { type: "confirmWindowPairing"; requestUid: string; windowUid: string }
  | {
      type: "clientDebugLog";
      time: string;
      tag: string;
      message: string;
      details?: unknown;
    }
  | { type: "resync"; requestUid: string }
  | { type: "heartbeat" };

export type NativeMessage =
  | { type: "ready"; protocolVersion: typeof PROTOCOL_VERSION }
  | {
      type: "invoke";
      actionUid: string;
      // Bound menus carry the fixed target window. A free menu omits it, so the extension resolves
      // the target as the instance's current lastFocused window at dispatch time.
      windowUid?: string | null;
      menuUid?: string;
    }
  | {
      // Desktop echoes a surface's new geometry after the user drags/resizes it
      // (bound: anchor + offsets + item size; free: item size). The free
      // surface's absolute position is reported separately via updateFreePlacement,
      // so a high-frequency drag stays a slim position-only message.
      type: "updateMenuPlacement";
      menuUid: string;
      placement: MenuPlacement;
    }
  | {
      // Desktop reports a free surface's new absolute screen position after the
      // user drags it; the extension persists it in free_placements.
      type: "updateFreePlacement";
      menuUid: string;
      x: number;
      y: number;
    }
  | { type: "verifyWindowPairing"; requestUid: string; windowUid: string }
  | { type: "pairWindowResult"; requestUid: string; windowUid: string; ok: boolean }
  | { type: "resyncComplete"; requestUid: string }
  | { type: "heartbeat" };

export function isNativeMessage(value: unknown): value is NativeMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return value.protocolVersion === PROTOCOL_VERSION;
    case "invoke":
      return (
        typeof value.actionUid === "string" &&
        (value.windowUid === undefined ||
          value.windowUid === null ||
          typeof value.windowUid === "string")
      );
    case "updateMenuPlacement":
      return typeof value.menuUid === "string" && isMenuPlacement(value.placement);
    case "updateFreePlacement":
      return (
        typeof value.menuUid === "string" &&
        typeof value.x === "number" &&
        typeof value.y === "number"
      );
    case "verifyWindowPairing":
      return typeof value.requestUid === "string" && typeof value.windowUid === "string";
    case "pairWindowResult":
      return (
        typeof value.requestUid === "string" &&
        typeof value.windowUid === "string" &&
        typeof value.ok === "boolean"
      );
    case "resyncComplete":
      return typeof value.requestUid === "string";
    case "heartbeat":
      return true;
    default:
      return false;
  }
}

function isMenuPlacement(value: unknown): value is MenuPlacement {
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
