export const PROTOCOL_VERSION = 1 as const;
export const SOCKET_URL = "ws://127.0.0.1:17654" as const;

export const EXPORT_SCHEMA_VERSION = 1 as const;

export type BrowserKind = "brave" | "chrome" | "edge" | "firefox" | "opera" | "vivaldi";
export type AttachmentMode = "none" | "lastFocused" | "all";
export type MenuAnchor = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export type MenuOrientation = "row" | "column";

export interface BrowserInstance {
  uid: string;
  browser: BrowserKind;
  label: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserWindowSnapshot {
  uid: string;
  bounds: WindowBounds;
  focused?: boolean;
}

export type MenuFontSize = number | "small" | "medium" | "large";

export interface MenuPlacement {
  anchor: MenuAnchor;
  height: number;
  offsetX: number;
  offsetY: number;
  width: number;
  itemWidth?: number;
  itemHeight?: number;
  fontSize?: MenuFontSize;
  gap?: number;
}

export interface BookmarkEntry {
  kind: "bookmark";
  uid: string;
  label: string;
  color?: string;
  rename?: string;
}

export type OnTopMode = "aboveBrowser" | "alwaysOnTop";
export type ExpandDirection = "down" | "right";

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

export type LayoutEntry = BookmarkEntry | FolderEntry | SpaceEntry;

export interface MenuSnapshot {
  attachmentMode?: AttachmentMode;
  color?: string;
  expandDirection?: ExpandDirection;
  fontSize?: MenuFontSize;
  gap?: number;
  items: LayoutEntry[];
  onTopMode?: OnTopMode;
  orientation: MenuOrientation;
  placement: MenuPlacement;
  uid: string;
}

export interface PanelSnapshot {
  onTopMode?: OnTopMode;
  menus: MenuSnapshot[];
  window: BrowserWindowSnapshot;
}

export type ClientMessage =
  | {
      type: "hello";
      protocolVersion: typeof PROTOCOL_VERSION;
      instance: BrowserInstance;
    }
  | {
      type: "sync";
      revision: number;
      attachmentMode: AttachmentMode;
      panels: PanelSnapshot[];
    }
  | {
      type: "actionResult";
      requestUid: string;
      ok: boolean;
      message?: string;
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

export type ServerMessage =
  | { type: "ready"; protocolVersion: typeof PROTOCOL_VERSION }
  | {
      type: "invoke";
      requestUid: string;
      actionUid: string;
      windowUid: string;
    }
  | {
      type: "updateMenuPlacement";
      menuUid: string;
      placement: MenuPlacement;
    }
  | { type: "verifyWindowPairing"; requestUid: string; windowUid: string }
  | { type: "pairWindowResult"; requestUid: string; windowUid: string; ok: boolean }
  | { type: "resyncComplete"; requestUid: string }
  | { type: "heartbeat" };

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return value.protocolVersion === PROTOCOL_VERSION;
    case "invoke":
      return (
        typeof value.requestUid === "string" &&
        typeof value.actionUid === "string" &&
        typeof value.windowUid === "string"
      );
    case "updateMenuPlacement":
      return typeof value.menuUid === "string" && isMenuPlacement(value.placement);
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
  return (
    isRecord(value) &&
    (value.anchor === "topLeft" ||
      value.anchor === "topRight" ||
      value.anchor === "bottomLeft" ||
      value.anchor === "bottomRight") &&
    [value.height, value.offsetX, value.offsetY, value.width].every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type TabOpenMode = "newTab" | "replace";
export type ExportedItemType = "bookmark" | "folder" | "flattenFolder" | "space" | (string & {});

export interface ExportedMenuItem {
  type: ExportedItemType;
  path?: string[];
  bookmarkId?: string;
  units?: number;
  transparent?: boolean;
  rename?: string;
  color?: string;
  expandDirection?: ExpandDirection;
  expandOnHover?: boolean;
  tabMode?: TabOpenMode;
}

export interface ExportedMenu {
  uid?: string;
  orientation: MenuOrientation;
  fontSize?: MenuFontSize;
  gap?: number;
  color?: string;
  expandDirection?: ExpandDirection;
  attachmentMode?: AttachmentMode;
  onTopMode?: OnTopMode;
  tabMode?: TabOpenMode;
  items: ExportedMenuItem[];
}

export interface ExportedSettingsData {
  version: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  menus: ExportedMenu[];
}

export function isExportedSettingsData(value: unknown): value is ExportedSettingsData {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === EXPORT_SCHEMA_VERSION &&
    typeof value.exportedAt === "string" &&
    Array.isArray(value.menus)
  );
}
