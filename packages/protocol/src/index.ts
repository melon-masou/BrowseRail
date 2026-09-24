import type { ExpandDirection, MenuFontSize, MenuOrientation } from "./menu";
import type { AttachmentMode, OnTopMode } from "./native";

export * from "./menu";
export * from "./native";

export const EXPORT_SCHEMA_VERSION = 1 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Menu Items and Options Enum Typings
export const MENU_ITEM_TYPES = ["bookmark", "folder", "flattenFolder", "menuToggle", "space", "dynamic"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number] | (string & {});
export type StoredMenuItemType = MenuItemType;
export type ExportedItemType = MenuItemType;

export const TAB_MODES = ["replace", "newTab"] as const;
export type TabMode = (typeof TAB_MODES)[number];
export type TabOpenMode = TabMode;

export const EXPAND_DIRECTIONS = ["down", "right"] as const;
export const ATTACHMENT_MODES = ["lastFocused", "all", "free"] as const;
export const ON_TOP_MODES = ["aboveBrowser", "alwaysOnTop"] as const;
export const MENU_ORIENTATIONS = ["row", "column"] as const;
export const MENU_ANCHORS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

export interface StoredMenuItem {
  uid: string;
  path?: string[];
  url?: string;
  color?: string;
  cycleColors?: string[];
  rename?: string;
  type?: MenuItemType;
  // For `dynamic` items: the dynamic bookmark definition this item renders (see
  // ExtensionConfig.dynamicBookmarks). Its live URL/title come from local state.
  dynamicUid?: string;
  expandOnHover?: boolean;
  // For flattenFolder items: also emit the folder's sub-folders (as folders
  // inheriting this item's folder options), not just its bookmarks. Default off.
  includeFolders?: boolean;
  tabMode?: TabMode;
  units?: number;
  transparent?: boolean;
}

export interface UrlRule {
  uid: string;
  name: string;
  patterns: string[];
}

export interface StoredMenu {
  attachmentMode?: AttachmentMode;
  color?: string;
  enabled?: boolean;
  expandDirection?: ExpandDirection;
  buttonFontSize?: MenuFontSize;
  popupFontSize?: MenuFontSize;
  gap?: number;
  items: StoredMenuItem[];
  onTopMode?: OnTopMode;
  orientation: MenuOrientation;
  tabMode?: TabMode;
  uid: string;
  urlRuleUids?: string[];
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
  kind: "bookmark" | "folder" | "dynamic",
  uid: string,
  tabMode?: TabMode,
): string {
  const base = `${kind}:${encodeURIComponent(uid)}`;
  if ((kind === "bookmark" || kind === "dynamic") && tabMode === "newTab") {
    return `${base}?tab=newTab`;
  }
  return base;
}

export const actionUid = formatActionUid;

// Dynamic-bookmark navigation action. The target URL is not a browser bookmark
// but the dynamic bookmark's current live value, resolved at dispatch time.
export function isDynamicAction(actionUid: string): boolean {
  return actionUid.startsWith("dynamic:");
}

export interface ParsedDynamicAction {
  dynamicUid: string;
  tabMode: TabMode;
}

export function parseDynamicAction(actionUid: string): ParsedDynamicAction {
  const prefix = "dynamic:";
  if (!actionUid.startsWith(prefix)) {
    throw new Error("The action is not a dynamic bookmark navigation");
  }
  const raw = actionUid.slice(prefix.length);
  const qIndex = raw.indexOf("?tab=");
  if (qIndex !== -1) {
    return {
      dynamicUid: decodeURIComponent(raw.slice(0, qIndex)),
      tabMode: raw.slice(qIndex + 5) === "newTab" ? "newTab" : "replace",
    };
  }
  return { dynamicUid: decodeURIComponent(raw), tabMode: "replace" };
}

export interface ParsedBookmarkAction {
  uid: string;
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
    const uid = decodeURIComponent(raw.slice(0, qIndex));
    const mode = raw.slice(qIndex + 5);
    return {
      uid,
      tabMode: mode === "newTab" ? "newTab" : "replace",
    };
  }

  return {
    uid: decodeURIComponent(raw),
    tabMode: "replace",
  };
}

export function invertBookmarkActionUid(actionUid: string): string {
  const { uid, tabMode } = parseBookmarkAction(actionUid);
  return formatActionUid("bookmark", uid, tabMode === "newTab" ? "replace" : "newTab");
}

export interface ExportedMenuItem {
  type: MenuItemType;
  uid: string;
  path?: string[];
  url?: string;
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
  buttonFontSize?: MenuFontSize;
  popupFontSize?: MenuFontSize;
  gap?: number;
  color?: string;
  expandDirection?: ExpandDirection;
  attachmentMode?: AttachmentMode;
  onTopMode?: OnTopMode;
  tabMode?: TabMode;
  items: ExportedMenuItem[];
  urlRuleUids?: string[];
}

export interface ExportedSettingsData {
  version: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  menus: ExportedMenu[];
  urlRules?: UrlRule[];
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


  // Opaque and browser-internal URLs (for example about:blank and chrome://newtab)
  // have no usable hostname, so exact URL patterns are compared before host rules.
  if (lowerPattern.includes(":") && !lowerPattern.includes("://")) {
    return lowerUrl === lowerPattern;
  }

  // 3. Domain / URL prefix matching
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : "";
    const hostWithPort = `${host}${port}`;
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;

    if (lowerPattern.includes("://")) {
      if (parsed.protocol === "chrome:" || parsed.protocol === "about:") {
        return lowerUrl === lowerPattern || lowerUrl.startsWith(`${lowerPattern}/`);
      }
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
