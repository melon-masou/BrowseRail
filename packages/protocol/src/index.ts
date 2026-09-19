export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PORT = 17654 as const;
export const DEFAULT_WS_URL = "ws://127.0.0.1:17654" as const;
export const DEFAULT_HTTP_URL = "http://127.0.0.1:17654" as const;
export const SOCKET_URL = DEFAULT_WS_URL;

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

export type MenuFontSize = number;

/**
 * Placement configuration for positioning a menu relative to the browser window.
 *
 * NOTE: Total window dimensions (`width` and `height`) are intentionally excluded from
 * this protocol contract. The total bounding dimensions of the menu bar are derived
 * dynamically at runtime by Tauri (from `itemWidth`, `itemHeight`, `gap`, orientation,
 * and item count) and belong to internal window geometry rather than user placement config.
 */
export interface MenuPlacement {
  anchor: MenuAnchor;
  offsetX: number;
  offsetY: number;
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
  enabled?: boolean;
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
        typeof value.actionUid === "string" && typeof value.windowUid === "string"
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
    [value.offsetX, value.offsetY].every(
      (part) => typeof part === "number" && Number.isFinite(part),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Menu Items and Options Enum Typings
export const MENU_ITEM_TYPES = ["bookmark", "folder", "flattenFolder", "space"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number] | (string & {});
export type StoredMenuItemType = MenuItemType;
export type ExportedItemType = MenuItemType;

export const TAB_MODES = ["replace", "newTab"] as const;
export type TabMode = (typeof TAB_MODES)[number];
export type TabOpenMode = TabMode;

export const EXPAND_DIRECTIONS = ["down", "right"] as const;
export const ATTACHMENT_MODES = ["none", "lastFocused", "all"] as const;
export const ON_TOP_MODES = ["aboveBrowser", "alwaysOnTop"] as const;
export const MENU_ORIENTATIONS = ["row", "column"] as const;
export const MENU_ANCHORS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

export interface StoredMenuItem {
  bookmarkId: string;
  path?: string[];
  url?: string;
  color?: string;
  cycleColors?: string[];
  emoji?: string;
  rename?: string;
  type?: MenuItemType;
  expandOnHover?: boolean;
  // For flattenFolder items: also emit the folder's sub-folders (as folders
  // inheriting this item's folder options), not just its bookmarks. Default off.
  includeFolders?: boolean;
  tabMode?: TabMode;
  units?: number;
  transparent?: boolean;
}

export interface WebpageSet {
  uid: string;
  name: string;
  patterns: string[];
}

export interface StoredMenu {
  attachmentMode?: AttachmentMode;
  color?: string;
  enabled?: boolean;
  expandDirection?: ExpandDirection;
  fontSize?: MenuFontSize;
  gap?: number;
  items: StoredMenuItem[];
  onTopMode?: OnTopMode;
  orientation: MenuOrientation;
  tabMode?: TabMode;
  uid: string;
  webpageSetUids?: string[];
}

// Special Root Placeholders
export const SPECIAL_ROOT_TYPES = ["bookmarks-bar", "other", "mobile", "managed"] as const;
export type SpecialRootType = (typeof SPECIAL_ROOT_TYPES)[number];

export const SPECIAL_ROOT_PLACEHOLDERS: Record<SpecialRootType, string> = {
  "bookmarks-bar": "${bookmarks-bar}",
  other: "${other}",
  mobile: "${mobile}",
  managed: "${managed}",
};

export function isSpecialRootPlaceholder(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === SPECIAL_ROOT_PLACEHOLDERS["bookmarks-bar"] ||
      value === SPECIAL_ROOT_PLACEHOLDERS.other ||
      value === SPECIAL_ROOT_PLACEHOLDERS.mobile ||
      value === SPECIAL_ROOT_PLACEHOLDERS.managed)
  );
}

// Action UID Wire Protocol
export function formatActionUid(
  kind: "bookmark" | "folder",
  bookmarkId: string,
  tabMode?: TabMode,
): string {
  const base = `${kind}:${encodeURIComponent(bookmarkId)}`;
  if (kind === "bookmark" && tabMode === "newTab") {
    return `${base}?tab=newTab`;
  }
  return base;
}

export const actionUid = formatActionUid;

export interface ParsedBookmarkAction {
  bookmarkId: string;
  tabMode: TabMode;
}

export function parseBookmarkAction(actionUid: string): ParsedBookmarkAction {
  const prefix = "bookmark:";
  if (!actionUid.startsWith(prefix)) {
    throw new Error("The action is not a bookmark navigation");
  }

  const raw = actionUid.slice(prefix.length);
  const qIndex = raw.indexOf("?tab=");
  if (qIndex !== -1) {
    const bookmarkId = decodeURIComponent(raw.slice(0, qIndex));
    const mode = raw.slice(qIndex + 5);
    return {
      bookmarkId,
      tabMode: mode === "newTab" ? "newTab" : "replace",
    };
  }

  return {
    bookmarkId: decodeURIComponent(raw),
    tabMode: "replace",
  };
}

export function invertBookmarkActionUid(actionUid: string): string {
  const { bookmarkId, tabMode } = parseBookmarkAction(actionUid);
  return formatActionUid("bookmark", bookmarkId, tabMode === "newTab" ? "replace" : "newTab");
}

export interface ExportedMenuItem {
  type: MenuItemType;
  path?: string[];
  bookmarkId?: string;
  units?: number;
  transparent?: boolean;
  rename?: string;
  color?: string;
  cycleColors?: string[];
  expandDirection?: ExpandDirection;
  expandOnHover?: boolean;
  includeFolders?: boolean;
  tabMode?: TabMode;
}

export interface ExportedMenu {
  uid?: string;
  enabled?: boolean;
  orientation: MenuOrientation;
  fontSize?: MenuFontSize;
  gap?: number;
  color?: string;
  expandDirection?: ExpandDirection;
  attachmentMode?: AttachmentMode;
  onTopMode?: OnTopMode;
  tabMode?: TabMode;
  items: ExportedMenuItem[];
  webpageSetUids?: string[];
}

export interface ExportedSettingsData {
  version: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  menus: ExportedMenu[];
  webpageSets?: WebpageSet[];
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

/**
 * Tests whether a URL matches a pattern.
 *
 * Supported pattern formats:
 * 1. Regular expression: starts and ends with '/' (e.g. `/^https:\/\/github\.com\//`)
 * 2. Wildcard: contains asterisk (e.g. `*.google.com`, `https://*.example.com/api`)
 * 3. Domain or Domain/Path prefix: e.g. `github.com`, `bilibili.com/video`, `localhost:3000`
 *    - Matches the domain or any subdomain (`*.github.com`)
 *    - If path is present, verifies the pathname starts with that path
 */
export function matchUrlPattern(pattern: string, url: string): boolean {
  const p = pattern.trim();
  if (!p || !url) return false;

  // 1. Regular expression: /pattern/flags
  if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
    const lastSlash = p.lastIndexOf("/");
    const regexBody = p.slice(1, lastSlash);
    const regexFlags = p.slice(lastSlash + 1) || "i";
    try {
      return new RegExp(regexBody, regexFlags).test(url);
    } catch {
      return false;
    }
  }

  const lowerUrl = url.toLowerCase();
  const lowerPattern = p.toLowerCase();

  // 2. Wildcard pattern containing '*'
  if (lowerPattern.includes("*")) {
    const escaped = lowerPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    try {
      if (new RegExp(`^${escaped}$`, "i").test(lowerUrl)) {
        return true;
      }
      try {
        const parsed = new URL(url);
        if (new RegExp(`^${escaped}$`, "i").test(parsed.hostname)) {
          return true;
        }
        if (lowerPattern.startsWith("*.")) {
          const apex = lowerPattern.slice(2);
          if (parsed.hostname === apex || parsed.hostname.endsWith("." + apex)) {
            return true;
          }
        }
      } catch {}
      return false;
    } catch {
      return false;
    }
  }

  // 3. Domain / URL prefix matching
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : "";
    const hostWithPort = `${host}${port}`;
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;

    if (lowerPattern.includes("://")) {
      return lowerUrl.startsWith(lowerPattern);
    }

    const slashIdx = lowerPattern.indexOf("/");
    if (slashIdx !== -1) {
      const targetHost = lowerPattern.slice(0, slashIdx);
      const rawTargetPath = lowerPattern.slice(slashIdx);
      const targetPath =
        rawTargetPath.endsWith("/") && rawTargetPath.length > 1
          ? rawTargetPath.slice(0, -1)
          : rawTargetPath;

      const hostMatches =
        host === targetHost ||
        hostWithPort === targetHost ||
        host.endsWith(`.${targetHost}`);

      return (
        hostMatches &&
        (pathAndQuery === targetPath ||
          pathAndQuery.startsWith(targetPath + "/") ||
          pathAndQuery.startsWith(rawTargetPath))
      );
    }

    if (lowerPattern.includes(":")) {
      return hostWithPort === lowerPattern || hostWithPort.endsWith(`.${lowerPattern}`);
    }

    return host === lowerPattern || host.endsWith(`.${lowerPattern}`);
  } catch {
    return lowerUrl.includes(lowerPattern);
  }
}

export function isUrlMatchingSet(url: string, patterns: string[]): boolean {
  if (!url || !Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((p) => matchUrlPattern(p, url));
}
