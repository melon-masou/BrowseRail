import { normalizeItemIcon, AUTO_FONT_SIZE, BROWSER_ACTION_KINDS, DEFAULT_MENU_COLOR, isAutoFontSize, customBookmarkReference, isShortcutActionType, type ShortcutAction } from "@browserail/protocol";
import type { JsonValue } from "@browserail/protocol/api";
import type { BrowserMenuPlacement } from "@browserail/protocol/content";
import { normalizeUserVariables } from "./user-variables";
export { normalizeUserVariables } from "./user-variables";
import { normalizeStaticBookmarkTags } from "./static-bookmark-tags";
import type {
  MenuAnchor,
  MenuFontSize,
  MenuItemType,
  MenuOrientation,
  MenuPlacement,
  StoredMenu,
  StoredMenuItem,
  StoredMenuItemType,
  StoredShortcut,
  StoredNativeShortcut,
  StoredNativeShortcutSet,
  TabMode,
  UrlRule,
  StaticBookmark,
  TemporaryBookmark,
  ExternalAction,
  ExportedDynamicBookmark,
} from "@browserail/protocol";

import { DEFAULT_DESKTOP_URL, isLocalDesktopUrl } from "../desktop/connection";
import { isRecord } from "./records";

export function normalizeShortcutAction(value: unknown): ShortcutAction | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "shortcutsToggle") return { type: "shortcutsToggle" };
  if (value.type === "browserAction" && BROWSER_ACTION_KINDS.includes(value.browserAction as (typeof BROWSER_ACTION_KINDS)[number]))
    return { type: "browserAction", browserAction: value.browserAction as (typeof BROWSER_ACTION_KINDS)[number] };
  if ((value.type === "menuFold" || value.type === "autoHideToggle") && typeof value.menuUid === "string" && value.menuUid)
    return { type: value.type, menuUid: value.menuUid };
  if (value.type === "menusToggle" && Array.isArray(value.targetMenuUids))
    return { type: "menusToggle", targetMenuUids: [...new Set(value.targetMenuUids.filter((uid): uid is string => typeof uid === "string" && !!uid))] };
  return undefined;
}

export function normalizeNativeShortcutSets(value: unknown): StoredNativeShortcutSet[] {
  return (Array.isArray(value) ? value : []).flatMap((set): StoredNativeShortcutSet[] => {
    if (!isRecord(set) || typeof set.uid !== "string" || !set.uid) return [];
    const urlRuleUids = Array.isArray(set.urlRuleUids)
      ? [...new Set(set.urlRuleUids.filter((uid): uid is string => typeof uid === "string" && !!uid))]
      : [];
    const shortcuts = (Array.isArray(set.shortcuts) ? set.shortcuts : []).flatMap((sc): StoredNativeShortcut[] => {
      if (!isRecord(sc)) return [];
      if (typeof sc.id !== "string" || !sc.id) return [];
      const key = typeof sc.key === "string" ? sc.key.trim() : "";
      if (isShortcutActionType(sc.type)) {
        const action = normalizeShortcutAction(sc);
        return action ? [{ id: sc.id, key, ...action }] : [];
      }
      const type = sc.type === "dynamic" || sc.type === "static" || sc.type === "temporary" || sc.type === "externalAction" ? sc.type : "bookmark";
      const path = Array.isArray(sc.path) ? sc.path.filter((p): p is string => typeof p === "string") : undefined;
      const url = typeof sc.url === "string" && sc.url ? sc.url : undefined;
      const title = typeof sc.title === "string" && sc.title ? sc.title : undefined;
      const dynamicUid = typeof sc.dynamicUid === "string" && sc.dynamicUid ? sc.dynamicUid : undefined;
      const staticUid = typeof sc.staticUid === "string" && sc.staticUid ? sc.staticUid : undefined;
      const temporaryUid = typeof sc.temporaryUid === "string" && sc.temporaryUid ? sc.temporaryUid : undefined;
      const externalActionUid = typeof sc.externalActionUid === "string" && sc.externalActionUid ? sc.externalActionUid : undefined;
      const tabMode = sc.tabMode === "newTab" || sc.tabMode === "replace" ? sc.tabMode : undefined;
      return [
        {
          id: sc.id,
          key,
          type,
          ...(path !== undefined ? { path } : {}),
          ...(url ? { url } : {}),
          ...(title ? { title } : {}),
          ...(dynamicUid ? { dynamicUid } : {}),
          ...(staticUid ? { staticUid } : {}),
          ...(temporaryUid ? { temporaryUid } : {}),
          ...(externalActionUid ? { externalActionUid } : {}),
          ...(tabMode ? { tabMode } : {}),
        },
      ];
    });
    return [{ uid: set.uid, name: typeof set.name === "string" ? set.name : "",
      ...(urlRuleUids.length ? { urlRuleUids } : {}), shortcuts }];
  });
}

export function normalizeUrlRules(value: unknown): UrlRule[] {
  return (Array.isArray(value) ? value : []).flatMap((rule): UrlRule[] => {
    if (!isRecord(rule) || typeof rule.uid !== "string" || !rule.uid) return [];
    return [{
      uid: rule.uid,
      name: typeof rule.name === "string" && rule.name.trim() ? rule.name.trim() : "URL rule",
      patterns: Array.isArray(rule.patterns)
        ? rule.patterns.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map(p => p.trim())
        : [],
    }];
  });
}

export function menuUrlRules(menu: StoredMenu, config: Pick<ExtensionConfig, "urlRules" | "defaultUrlRuleUid">): UrlRule[] {
  const uids = menu.urlRuleUids?.length
    ? menu.urlRuleUids
    : config.defaultUrlRuleUid ? [config.defaultUrlRuleUid] : [];
  return uids.map(uid => config.urlRules.find(rule => rule.uid === uid) ?? { uid, name: "", patterns: [] });
}

export type {
  MenuItemType,
  StoredMenuItemType,
  TabMode,
  StoredMenuItem,
  StoredMenu,
  StoredShortcut,
  StoredNativeShortcut,
  StoredNativeShortcutSet,
  UrlRule,
  StaticBookmark,
  TemporaryBookmark,
  ExternalAction,
};

// Definitions are shared config; the saved URL/title/note stay in local storage.
export type DynamicBookmark = ExportedDynamicBookmark;

export function normalizeDynamicBookmarks(value: unknown): DynamicBookmark[] {
  return (Array.isArray(value) ? value : []).flatMap((db): DynamicBookmark[] => {
    if (!isRecord(db) || typeof db.uid !== "string" || !db.uid) return [];
    if (db.type !== "rule" && db.type !== "rewrite" && db.type !== "external") return [];
    return [{
      uid: db.uid,
      name: typeof db.name === "string" && db.name.trim() ? db.name.trim() : "Dynamic bookmark",
      type: db.type,
      ...(typeof db.rewrite === "string" ? { rewrite: db.rewrite } : {}),
      ...(typeof db.urlRuleUid === "string" && db.urlRuleUid ? { urlRuleUid: db.urlRuleUid } : {}),
    }];
  });
}

export function normalizeGlobalCss(value: unknown): Record<string, string> {
  return Object.fromEntries(isRecord(value)
    ? Object.entries(value).flatMap(([key, css]): [string, string][] => key.trim().length > 0 && typeof css === "string" ? [[key, css]] : [])
    : []);
}

export interface ExtensionConfig {
  globalCss?: Record<string, string>;
  desktopWidget: {
    url: string;
  };
  instanceLabel: string;
  panel: {
    menus: StoredMenu[];
  };
  urlRules: UrlRule[];
  defaultUrlRuleUid?: string;
  dynamicBookmarks: DynamicBookmark[];
  staticBookmarks: StaticBookmark[];
  temporaryBookmarks: TemporaryBookmark[];
  externalActions: ExternalAction[];
  userVariables: Record<string, JsonValue>;
  shortcuts: StoredShortcut[];
  nativeShortcutSets: StoredNativeShortcutSet[];
}

export const DEFAULT_FONT_SIZE = 13;

// Preserves the AUTO_FONT_SIZE sentinel (-1); every other value resolves to a
// concrete px >= 1. Callers that need real pixels (e.g. getItemDimensions) must
// map auto to a default themselves.
export function normalizeFontSize(value: unknown): number {
  if (isAutoFontSize(value)) {
    return AUTO_FONT_SIZE;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  if (value === "small") return 12;
  if (value === "large") return 15;
  if (value === "medium") return 13;
  return DEFAULT_FONT_SIZE;
}

export function createMenu(uid: string = crypto.randomUUID()): StoredMenu {
  return { color: DEFAULT_MENU_COLOR, enabled: true, items: [], uid };
}

const DEFAULT_CONFIG: Omit<ExtensionConfig, "instanceLabel"> = {
  desktopWidget: {
    url: DEFAULT_DESKTOP_URL,
  },
  panel: {
    menus: [],
  },
  urlRules: [],
  dynamicBookmarks: [],
  staticBookmarks: [],
  temporaryBookmarks: [],
  externalActions: [],
  userVariables: {},
  shortcuts: [],
  nativeShortcutSets: [],
};

export const DEFAULT_ITEM_WIDTH = 84;
export const DEFAULT_ITEM_HEIGHT = 36;

export function getItemDimensions(fontSize: MenuFontSize = DEFAULT_FONT_SIZE): { itemWidth: number; itemHeight: number } {
  // Auto has no fixed px, so default item dimensions come from the default font
  // size; the actual auto font is then derived back from the button height.
  const normalized = normalizeFontSize(fontSize);
  const fs = normalized > 0 ? normalized : DEFAULT_FONT_SIZE;
  const itemHeight = Math.max(26, Math.round(fs * 2.7));
  const itemWidth = Math.max(54, Math.round(fs * 6.5));
  return { itemWidth, itemHeight };
}

export function defaultMenuPlacement(
  index = 0,
  _orientation: MenuOrientation = "column",
  _itemCount = 1,
  fontSize: MenuFontSize = DEFAULT_FONT_SIZE,
): MenuPlacement & { itemWidth: number; itemHeight: number } {
  const { itemWidth, itemHeight } = getItemDimensions(fontSize);

  return {
    boundPosition: {
      anchor: "topLeft",
      offsetX: 12,
      offsetY: 12 + index * (itemHeight + 12),
    },
    itemHeight,
    itemWidth,
  };
}

export function resolveMenuPlacement(
  storedPlacement: MenuPlacement | undefined,
  index = 0,
  orientation: MenuOrientation = "column",
  _itemCount = 1,
  fontSize: MenuFontSize = DEFAULT_FONT_SIZE,
): MenuPlacement {
  const defaultDim = getItemDimensions(fontSize);

  // A never-customized menu still needs default anchor/offsets and a default per-button
  // size; a remembered placement supplies those from the last desktop customization.
  const base = storedPlacement ?? defaultMenuPlacement(index, orientation, 1, fontSize);

  const itemWidth =
    typeof base.itemWidth === "number" && base.itemWidth > 0 ? base.itemWidth : defaultDim.itemWidth;
  const itemHeight =
    typeof base.itemHeight === "number" && base.itemHeight > 0
      ? base.itemHeight
      : defaultDim.itemHeight;

  // The extension only carries the per-button size + placement. The TOTAL width/height
  // is NOT computed or stored here — the desktop derives it dynamically from
  // itemWidth/itemHeight × item count.
  return {
    boundPosition: { ...base.boundPosition },
    itemWidth,
    itemHeight,
  };
}

export function normalizeConfig(value: unknown, defaultInstanceLabel: string): ExtensionConfig {
  if (!isRecord(value)) {
    return { ...structuredClone(DEFAULT_CONFIG), instanceLabel: defaultInstanceLabel };
  }

  const desktopWidget = isRecord(value.desktopWidget) ? value.desktopWidget : {};
  const panel = isRecord(value.panel) ? value.panel : {};

  const rawMenus = Array.isArray(panel.menus)
    ? panel.menus.flatMap((menu) => {
        const norm = normalizeMenu(menu);
        return norm ? [norm] : [];
      })
    : [];
  const seenUids = new Set<string>();
  const menus = rawMenus.map((menu) => {
    let uid = menu.uid;
    if (seenUids.has(uid)) {
      uid = crypto.randomUUID();
    }
    seenUids.add(uid);
    return {
      ...menu,
      uid,
    };
  });

  const urlRules = normalizeUrlRules(value.urlRules);
  const globalCss = normalizeGlobalCss(value.globalCss);

  const dynamicBookmarks = normalizeDynamicBookmarks(value.dynamicBookmarks);
  const dynamicUids = new Set(dynamicBookmarks.map(bookmark => bookmark.uid));
  // Keep missing references editable; discard references only to rejected definitions.
  const rejectedDynamicUids = new Set((Array.isArray(value.dynamicBookmarks) ? value.dynamicBookmarks : [])
    .flatMap(db => isRecord(db) && typeof db.uid === "string" && !dynamicUids.has(db.uid) ? [db.uid] : []));
  for (const menu of menus)
    menu.items = menu.items.filter(item => item.type !== "dynamic" || !!item.dynamicUid && !rejectedDynamicUids.has(item.dynamicUid));

  const rawShortcuts = Array.isArray(value.shortcuts) ? value.shortcuts : [];
  const shortcuts: StoredShortcut[] = rawShortcuts.flatMap((sc): StoredShortcut[] => {
    if (!isRecord(sc)) return [];
    if (typeof sc.slot !== "string" || !sc.slot.startsWith("slot_")) return [];
    if (isShortcutActionType(sc.type)) {
      const action = normalizeShortcutAction(sc);
      return action ? [{ slot: sc.slot, ...action }] : [];
    }
    const type = sc.type === "dynamic" || sc.type === "static" || sc.type === "temporary" || sc.type === "externalAction" ? sc.type : "bookmark";
    const path = Array.isArray(sc.path) ? sc.path.filter((p): p is string => typeof p === "string") : undefined;
    const url = typeof sc.url === "string" && sc.url ? sc.url : undefined;
    const title = typeof sc.title === "string" && sc.title ? sc.title : undefined;
    const dynamicUid = typeof sc.dynamicUid === "string" && sc.dynamicUid ? sc.dynamicUid : undefined;
    if (type === "dynamic" && (!dynamicUid || rejectedDynamicUids.has(dynamicUid))) return [];
    const staticUid = typeof sc.staticUid === "string" && sc.staticUid ? sc.staticUid : undefined;
    const temporaryUid = typeof sc.temporaryUid === "string" && sc.temporaryUid ? sc.temporaryUid : undefined;
    const externalActionUid = typeof sc.externalActionUid === "string" && sc.externalActionUid ? sc.externalActionUid : undefined;
    const tabMode = sc.tabMode === "newTab" || sc.tabMode === "replace" ? sc.tabMode : undefined;
    return [
      {
        slot: sc.slot,
        type,
        ...(path !== undefined ? { path } : {}),
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        ...(dynamicUid ? { dynamicUid } : {}),
        ...(staticUid ? { staticUid } : {}),
        ...(temporaryUid ? { temporaryUid } : {}),
        ...(externalActionUid ? { externalActionUid } : {}),
        ...(tabMode ? { tabMode } : {}),
      },
    ];
  });

  const nativeShortcutSets = normalizeNativeShortcutSets(value.nativeShortcutSets).map(set => ({
    ...set, shortcuts: set.shortcuts.filter(sc => sc.type !== "dynamic" || !!sc.dynamicUid && !rejectedDynamicUids.has(sc.dynamicUid)),
  }));

  return {
    desktopWidget: {
      url:
        typeof desktopWidget.url === "string" && isLocalDesktopUrl(desktopWidget.url)
          ? desktopWidget.url
          : DEFAULT_CONFIG.desktopWidget.url,
    },
    instanceLabel:
      typeof value.instanceLabel === "string" && value.instanceLabel.trim()
        ? value.instanceLabel.trim()
        : defaultInstanceLabel,
    panel: {
      menus,
    },
    urlRules,
    ...(typeof value.defaultUrlRuleUid === "string" && urlRules.some(rule => rule.uid === value.defaultUrlRuleUid) ? { defaultUrlRuleUid: value.defaultUrlRuleUid } : {}),
    dynamicBookmarks,
    staticBookmarks: normalizeStaticBookmarks(value.staticBookmarks),
    temporaryBookmarks: normalizeTemporaryBookmarks(value.temporaryBookmarks),
    externalActions: normalizeExternalActions(value.externalActions),
    userVariables: normalizeUserVariables(value.userVariables),
    ...(Object.keys(globalCss).length ? { globalCss } : {}),
    shortcuts,
    nativeShortcutSets,
  };
}

export function normalizeStaticBookmarks(value: unknown): StaticBookmark[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): StaticBookmark[] => {
    if (!isRecord(entry) || typeof entry.uid !== "string" || !entry.uid) return [];
    const tags = normalizeStaticBookmarkTags(entry.tags);
    return [{ uid: entry.uid, name: typeof entry.name === "string" ? entry.name.trim() : "", url: typeof entry.url === "string" ? entry.url.trim() : "", ...(tags.length ? { tags } : {}) }];
  });
}

export function normalizeTemporaryBookmarks(value: unknown): TemporaryBookmark[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): TemporaryBookmark[] => {
    if (!isRecord(entry) || typeof entry.uid !== "string" || !entry.uid) return [];
    return [{ uid: entry.uid, name: typeof entry.name === "string" ? entry.name.trim() : "" }];
  });
}

export function normalizeExternalActions(value: unknown): ExternalAction[] {
  const text = (field: unknown): string | undefined => typeof field === "string" && field.trim() ? field.trim() : undefined;
  return (Array.isArray(value) ? value : []).flatMap((entry): ExternalAction[] => {
    if (!isRecord(entry) || typeof entry.uid !== "string" || !entry.uid) return [];
    const urlRuleUid = text(entry.urlRuleUid);
    const extensionId = text(entry.extensionId);
    const eventName = text(entry.eventName);
    const data = text(entry.data);
    return [{
      uid: entry.uid,
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      ...(urlRuleUid ? { urlRuleUid } : {}),
      target: entry.target === "extension" ? "extension" : "event",
      ...(extensionId ? { extensionId } : {}),
      ...(eventName ? { eventName } : {}),
      ...(data ? { data } : {}),
    }];
  });
}

export function normalizeMenu(value: unknown): StoredMenu | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const uid = typeof value.uid === "string" && value.uid
    ? value.uid
    : crypto.randomUUID();
  const color = typeof value.color === "string" && value.color ? value.color : DEFAULT_MENU_COLOR;
  const dockColor = typeof value.dockColor === "string" && value.dockColor ? value.dockColor : undefined;
  const enabled = typeof value.enabled === "boolean" ? value.enabled : true;
  const urlRuleUids = Array.isArray(value.urlRuleUids)
    ? value.urlRuleUids.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : undefined;
  const normalizedItems = Array.isArray(value.items)
    ? value.items.map(normalizeStoredMenuItem).filter((i): i is StoredMenuItem => i !== undefined)
    : [];
  let hasMenuFold = false;
  const items = normalizedItems.filter((item) => {
    if (item.type !== "menuFold") return true;
    if (hasMenuFold) return false;
    hasMenuFold = true;
    return true;
  });
  return {
    color,
    ...(dockColor !== undefined ? { dockColor } : {}),
    enabled, items,
    uid,
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(value.style === "text" || value.style === "textIcon" || value.style === "textColorIcon" || value.style === "icons" || value.style === "tiles" ? { style: value.style } : {}),
    ...(typeof value.cssClass === "string" && value.cssClass.trim() ? { cssClass: value.cssClass.trim() } : {}),
    ...(urlRuleUids && urlRuleUids.length > 0 ? { urlRuleUids } : {}),
  };
}

function boundedNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function isAnchor(value: unknown): value is MenuAnchor {
  return value === "topLeft" || value === "topRight" || value === "bottomLeft" || value === "bottomRight";
}

export function normalizeStoredMenuItem(value: unknown): StoredMenuItem | undefined {
  if (!isRecord(value)) return undefined;
  const cssClass = typeof value.cssClass === "string" ? value.cssClass.trim() : "";
  const icon = normalizeItemIcon(value.icon);
  const classes = { ...(cssClass ? { cssClass } : {}), ...(icon ? { icon } : {}) };
  const rawType = typeof value.type === "string" && value.type
    ? (value.type as StoredMenuItemType)
    : undefined;
  const uid = typeof value.uid === "string" && value.uid ? value.uid : crypto.randomUUID();
  if (rawType === "menuToggle" || rawType === "space") return undefined;

  if (rawType === "menuFold" || rawType === "shortcutsToggle" || rawType === "autoHideToggle") {
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    return {
      ...classes,
      uid,
      type: rawType,
      ...(rename ? { rename } : {}),
      ...(color ? { color } : {}),
    };
  }

  if (rawType === "browserAction" || rawType === "menusToggle") {
    if (rawType === "browserAction" && !BROWSER_ACTION_KINDS.includes(value.browserAction as (typeof BROWSER_ACTION_KINDS)[number])) return undefined;
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    const targetMenuUids = Array.isArray(value.targetMenuUids)
      ? [...new Set(value.targetMenuUids.filter((target): target is string => typeof target === "string" && target.length > 0))]
      : [];
    return {
      ...classes,
      uid,
      type: rawType,
      ...(rawType === "browserAction" ? { browserAction: value.browserAction as (typeof BROWSER_ACTION_KINDS)[number] } : { targetMenuUids }),
      ...(rename ? { rename } : {}),
      ...(color ? { color } : {}),
    };
  }

  if (rawType === "dynamic") {
    const dynamicUid = typeof value.dynamicUid === "string" && value.dynamicUid ? value.dynamicUid : undefined;
    if (!dynamicUid) return undefined;
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    return {
      ...classes,
      uid,
      type: "dynamic",
      dynamicUid,
      ...(rename ? { rename } : {}),
      ...(color ? { color } : {}),
    };
  }

  if (rawType === "staticTag" || rawType === "flattenStaticTag") {
    const staticTag = typeof value.staticTag === "string" ? value.staticTag.trim() : "";
    if (!staticTag) return undefined;
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    const expandOnHover = typeof value.expandOnHover === "boolean" ? value.expandOnHover : undefined;
    return { ...classes, uid, type: rawType, staticTag, ...(rename ? { rename } : {}), ...(color ? { color } : {}), ...(expandOnHover !== undefined ? { expandOnHover } : {}) };
  }

  if (rawType === "temporary" || rawType === "static" || rawType === "externalAction") {
    const targetUid = rawType === "temporary" ? value.temporaryUid : rawType === "static" ? value.staticUid : value.externalActionUid;
    if (typeof targetUid !== "string" || !targetUid) return undefined;
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    return { ...classes, uid, ...customBookmarkReference(rawType === "static" ? "static" : rawType === "temporary" ? "temporary" : "externalAction", targetUid), ...(rename ? { rename } : {}), ...(color ? { color } : {}) };
  }

  const path = Array.isArray(value.path) && value.path.every((p) => typeof p === "string")
    ? value.path
    : undefined;
  if (path === undefined) {
    return undefined;
  }
  const url = typeof value.url === "string" && value.url ? value.url : undefined;
  const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
  const cycleColors = Array.isArray(value.cycleColors)
    ? value.cycleColors.filter((c): c is string => typeof c === "string" && Boolean(c))
    : undefined;
  const color = typeof value.color === "string" && value.color ? value.color : undefined;
  const expandOnHover = typeof value.expandOnHover === "boolean" ? value.expandOnHover : undefined;
  const includeFolders = value.includeFolders === true ? true : undefined;
  return {
    ...classes,
    uid,
    path,
    ...(url ? { url } : {}),
    ...(rawType ? { type: rawType } : {}),
    ...(rename ? { rename } : {}),
    ...(color ? { color } : {}),
    ...(cycleColors && cycleColors.length > 0 ? { cycleColors } : {}),
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(includeFolders ? { includeFolders } : {}),
  };
}

export type DisplayMode = "native" | "browser";
export function normalizeBrowserPlacement(value: unknown): BrowserMenuPlacement | undefined {
  if (!isRecord(value) || !isAnchor(value.anchor)) return undefined;
  if (![value.offsetX, value.offsetY, value.itemWidth, value.itemHeight].every(part => typeof part === "number" && Number.isFinite(part))) return undefined;
  return {
    anchor: value.anchor,
    offsetX: boundedNumber(value.offsetX, -10_000, 10_000, 12),
    offsetY: boundedNumber(value.offsetY, -10_000, 10_000, 12),
    itemWidth: boundedNumber(value.itemWidth, 26, 400, DEFAULT_ITEM_WIDTH),
    itemHeight: boundedNumber(value.itemHeight, 26, 200, DEFAULT_ITEM_HEIGHT),
  };
}
