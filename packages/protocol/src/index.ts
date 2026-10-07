import type { MenuColor } from "./menu";
import type { JsonValue } from "./api";

export * from "./menu";
export * from "./native";

export * from "./bar";
export * from "./api";

export const EXPORT_SCHEMA_VERSION = 2 as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Menu Items and Options Enum Typings
export const MENU_ITEM_TYPES = ["bookmark", "folder", "flattenFolder", "staticTag", "flattenStaticTag", "menuFold", "menusToggle", "browserAction", "shortcutsToggle", "static", "dynamic", "temporary"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number] | (string & {});
export const BROWSER_ACTION_KINDS = ["back", "forward", "reload"] as const;
export type BrowserActionKind = (typeof BROWSER_ACTION_KINDS)[number];
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
  color?: MenuColor;
  cycleColors?: MenuColor[];
  rename?: string;
  type?: MenuItemType;
  // For `dynamic` items: the dynamic bookmark definition this item renders (see
  // ExtensionConfig.dynamicBookmarks). Its live URL/title come from local state.
  dynamicUid?: string;
  staticUid?: string;
  staticTag?: string;
  temporaryUid?: string;
  expandOnHover?: boolean;
  // For flattenFolder items: also emit the folder's sub-folders (as folders
  // inheriting this item's folder options), not just its bookmarks. Default off.
  includeFolders?: boolean;
  browserAction?: BrowserActionKind;
  targetMenuUids?: string[];
}

export type CustomBookmarkType = "static" | "temporary" | "dynamic";

export interface BookmarkTarget {
  type?: "bookmark" | CustomBookmarkType;
  path?: string[];
  url?: string;
  title?: string;
  dynamicUid?: string;
  staticUid?: string;
  temporaryUid?: string;
  tabMode?: TabMode;
}

export function isCustomBookmarkType(type: unknown): type is CustomBookmarkType {
  return type === "static" || type === "temporary" || type === "dynamic";
}

export function customBookmarkUid(target: { type?: string; dynamicUid?: string; staticUid?: string; temporaryUid?: string }): string | undefined {
  return target.type === "static" ? target.staticUid : target.type === "temporary" ? target.temporaryUid : target.type === "dynamic" ? target.dynamicUid : undefined;
}

export function customBookmarkReference(type: CustomBookmarkType, uid: string) {
  return { type, ...(type === "static" ? { staticUid: uid } : type === "temporary" ? { temporaryUid: uid } : { dynamicUid: uid }) };
}

export type ShortcutAction =
  | { type: "browserAction"; browserAction: BrowserActionKind }
  | { type: "menusToggle"; targetMenuUids: string[] }
  | { type: "menuFold"; menuUid: string }
  | { type: "shortcutsToggle" };

export function isShortcutActionType(type: unknown): type is ShortcutAction["type"] {
  return type === "browserAction" || type === "menusToggle" || type === "menuFold" || type === "shortcutsToggle";
}

export interface ShortcutTarget extends Omit<BookmarkTarget, "type"> {
  type?: NonNullable<BookmarkTarget["type"]> | ShortcutAction["type"];
  browserAction?: BrowserActionKind;
  targetMenuUids?: string[];
  menuUid?: string;
}

export interface StoredShortcut extends ShortcutTarget {
  slot: string;
}

export interface StoredNativeShortcut extends ShortcutTarget {
  id: string;
  key: string;
}

export interface SyncedNativeShortcut {
  id: string;
  key: string;
}

export interface UrlRule {
  uid: string;
  name: string;
  patterns: string[];
}

export interface StoredMenu {
  color?: MenuColor;
  dockColor?: MenuColor;
  enabled?: boolean;
  items: StoredMenuItem[];
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
  kind: "bookmark" | "folder" | CustomBookmarkType,
  uid: string,
  tabMode?: TabMode,
): string {
  const base = `${kind}:${encodeURIComponent(uid)}`;
  if (kind !== "folder" && tabMode === "newTab") {
    return `${base}?tab=newTab`;
  }
  return base;
}

export const actionUid = formatActionUid;

export function parseTemporaryAction(actionUid: string): { uid: string; tabMode: TabMode } {
  if (!actionUid.startsWith("temporary:")) throw new Error("The action is not a temporary bookmark");
  const raw = actionUid.slice("temporary:".length);
  const qIndex = raw.indexOf("?tab=");
  return {
    uid: decodeURIComponent(qIndex < 0 ? raw : raw.slice(0, qIndex)),
    tabMode: qIndex >= 0 && raw.slice(qIndex + 5) === "newTab" ? "newTab" : "replace",
  };
}

export function invertTemporaryActionUid(actionUid: string): string {
  const { uid, tabMode } = parseTemporaryAction(actionUid);
  return formatActionUid("temporary", uid, tabMode === "newTab" ? "replace" : "newTab");
}

export function parseStaticAction(actionUid: string): { uid: string; tabMode: TabMode } {
  if (!actionUid.startsWith("static:")) throw new Error("The action is not a static bookmark");
  const raw = actionUid.slice("static:".length);
  const qIndex = raw.indexOf("?tab=");
  return {
    uid: decodeURIComponent(qIndex < 0 ? raw : raw.slice(0, qIndex)),
    tabMode: qIndex >= 0 && raw.slice(qIndex + 5) === "newTab" ? "newTab" : "replace",
  };
}

export function invertNavigationActionUid(actionUid: string): string {
  if (actionUid.startsWith("temporary:")) return invertTemporaryActionUid(actionUid);
  if (actionUid.startsWith("static:")) {
    const { uid, tabMode } = parseStaticAction(actionUid);
    return formatActionUid("static", uid, tabMode === "newTab" ? "replace" : "newTab");
  }
  if (isDynamicAction(actionUid)) {
    const { dynamicUid, tabMode } = parseDynamicAction(actionUid);
    return formatActionUid("dynamic", dynamicUid, tabMode === "newTab" ? "replace" : "newTab");
  }
  return invertBookmarkActionUid(actionUid);
}

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
  rename?: string;
  color?: MenuColor;
  cycleColors?: MenuColor[];
  expandOnHover?: boolean;
  includeFolders?: boolean;
  // For `dynamic` items: the dynamic bookmark id they reference (resolved
  // against ExportedSettingsData.dynamicBookmarks on import).
  dynamicUid?: string;
  staticUid?: string;
  staticTag?: string;
  temporaryUid?: string;
  browserAction?: BrowserActionKind;
  targetMenuUids?: string[];
}

export interface ExportedDynamicBookmark {
  type: "rule" | "rewrite" | "external";
  // Bounds saved URLs; also triggers the automatic update methods.
  urlRuleUid?: string;
  uid: string;
  name: string;
  rewrite?: string;
}

export interface StaticBookmark {
  uid: string;
  name: string;
  url: string;
  tags?: string[];
}

export interface TemporaryBookmark {
  uid: string;
  name: string;
}

export interface ExportedMenu {
  uid: string;
  color?: MenuColor;
  dockColor?: MenuColor;
  items: ExportedMenuItem[];
  urlRuleUids?: string[];
}

export interface ExportedSettingsData {
  version: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  barConfigurations?: import("./bar").BarConfigurations;
  menus: ExportedMenu[];
  urlRules?: UrlRule[];
  defaultUrlRuleUid?: string;
  dynamicBookmarks?: ExportedDynamicBookmark[];
  staticBookmarks?: StaticBookmark[];
  temporaryBookmarks?: TemporaryBookmark[];
  userVariables?: Record<string, JsonValue>;
  shortcuts?: StoredShortcut[];
  nativeShortcuts?: StoredNativeShortcut[];
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
 * 2. Wildcard: host accepts `*.` only as a prefix (or `*` for all hosts);
 *    paths may contain asterisks (e.g. `https://*.example.com/api/*`).
 * 3. Domain or Domain/Path prefix: e.g. `github.com`, `bilibili.com/video`, `localhost:3000`
 *    - Matches the domain or any subdomain (`*.github.com`)
 *    - If path is present, verifies the pathname starts with that path
 */
export function matchUrlPattern(pattern: string, url: string): boolean {
  const p = pattern.trim();
  if (!p || p.startsWith("#") || !url) return false;

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
    if (lowerPattern === "*") return true;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname) return false;
      const scheme = /^([^/]+):\/\//.exec(lowerPattern);
      if (scheme && scheme[1] !== "*" && parsed.protocol !== `${scheme[1]}:`) return false;
      const rest = scheme ? lowerPattern.slice(scheme[0].length) : lowerPattern;
      const slash = rest.indexOf("/");
      const authority = slash < 0 ? rest : rest.slice(0, slash);
      if (/[\s?#@\\]/.test(authority)) return false;
      const port = /:(\d+|\*)$/.exec(authority);
      const hostPattern = port ? authority.slice(0, -port[0].length) : authority;
      const subdomains = hostPattern.startsWith("*.");
      const domain = subdomains ? hostPattern.slice(2) : hostPattern;
      if (!domain || (domain.includes("*") && (domain !== "*" || subdomains))) return false;
      if (domain !== "*") {
        const target = new URL(`https://${domain}/`);
        if (target.port || target.pathname !== "/") return false;
        const host = target.hostname;
        const allowSubdomains = subdomains || !scheme;
        if (parsed.hostname !== host && !(allowSubdomains && parsed.hostname.endsWith(`.${host}`))) return false;
      }
      if (port && port[1] !== "*" && parsed.port !== new URL(`${parsed.protocol}//${parsed.hostname}:${port[1]}/`).port) return false;
      if (slash < 0) return true;
      const path = rest.slice(slash).replace(/[.?+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${path}$`, "i").test(`${parsed.pathname}${parsed.search}${parsed.hash}`);
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
      const target = new URL(p);
      return parsed.protocol === target.protocol && parsed.hostname === target.hostname && parsed.port === target.port
        && parsed.href.toLowerCase().startsWith(target.href.toLowerCase());
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
  const active = activeUrlPatterns(patterns);
  return active.some(pattern => !pattern.startsWith("!") && matchUrlPattern(pattern, url))
    && !active.some(pattern => pattern.startsWith("!") && matchUrlPattern(pattern.slice(1).trim(), url));
}

/** Executable patterns only; preserve the original lines in configuration. */
export function activeUrlPatterns(patterns: readonly string[]): string[] {
  return patterns.map(pattern => pattern.trim()).filter(pattern => pattern && !pattern.startsWith("#"));
}

export function matchesUrlRule(url: string, rule: UrlRule): boolean {
  return isUrlMatchingSet(url, rule.patterns);
}
