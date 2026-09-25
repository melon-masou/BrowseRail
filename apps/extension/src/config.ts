import { AUTO_FONT_SIZE, isAutoFontSize } from "@browserail/protocol";
import type {
  AttachmentMode,
  ExpandDirection,
  MenuAnchor,
  MenuFontSize,
  MenuItemType,
  MenuOrientation,
  MenuPlacement,
  OnTopMode,
  StoredMenu,
  StoredMenuItem,
  StoredMenuItemType,
  TabMode,
  UrlRule,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import { DEFAULT_DESKTOP_URL, isLocalDesktopUrl } from "./desktop-connection";
import { loadInstanceUid } from "./instance-identity";
import { instanceLabelFromUid } from "./instance-label";

const STORAGE_KEY = "config";

export type {
  MenuItemType,
  StoredMenuItemType,
  TabMode,
  StoredMenuItem,
  StoredMenu,
  UrlRule,
};

// A user-defined dynamic bookmark: its function body maintains a live URL/title
// that updates as the user browses (see the sandbox runner). The definition is
// synced with config; the live value lives in local `dynamic_values` only.
export interface DynamicBookmark {
  uid: string;
  name: string;
  code: string;
  // urlRules this bookmark's function reacts to; empty/undefined = all visits.
  urlRuleUids?: string[];
}

export interface ExtensionConfig {
  desktopWidget: {
    url: string;
  };
  instanceLabel: string;
  panel: {
    menus: StoredMenu[];
  };
  urlRules: UrlRule[];
  dynamicBookmarks: DynamicBookmark[];
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

export const DEFAULT_MENU_GAP_PERCENT = 11; // ~11% of button size (approx 4px for 35px button)
export const DEFAULT_MENU_GAP = DEFAULT_MENU_GAP_PERCENT;

export function calculateGapPx(buttonDim: number, gapPercent: number): number {
  if (gapPercent <= 0) return 0;
  return Math.max(0, Math.round((buttonDim * gapPercent) / 100));
}

export function createMenu(uid: string = crypto.randomUUID()): StoredMenu {
  return {
    attachmentMode: "lastFocused",
    enabled: true,
    // Button font auto-scales with button height by default; popup stays fixed.
    buttonFontSize: AUTO_FONT_SIZE,
    popupFontSize: DEFAULT_FONT_SIZE,
    gap: DEFAULT_MENU_GAP_PERCENT,
    items: [],
    onTopMode: "aboveBrowser",
    orientation: "column",
    uid,
  };
}

const DEFAULT_CONFIG: Omit<ExtensionConfig, "instanceLabel"> = {
  desktopWidget: {
    url: DEFAULT_DESKTOP_URL,
  },
  panel: {
    menus: [createMenu()],
  },
  urlRules: [],
  dynamicBookmarks: [],
};

export const DEFAULT_ITEM_WIDTH = 84;
export const DEFAULT_ITEM_HEIGHT = 36;
export const MENU_GAP = DEFAULT_MENU_GAP;

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
): MenuPlacement {
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

// Inter-item gap in px, resolved from the menu's gap percentage. Gap is
// config-owned render appearance (it lives on MenuView, not MenuPlacement), so
// it is derived here rather than carried on the desktop-owned placement.
export function resolveGapPx(
  fontSize: MenuFontSize = DEFAULT_FONT_SIZE,
  gapPercent = DEFAULT_MENU_GAP_PERCENT,
): number {
  return calculateGapPx(getItemDimensions(fontSize).itemHeight, gapPercent);
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

export const SYNC_ENABLED_STORAGE_KEY = "sync_enabled";
export const SYNC_CONFIG_KEY = "sync_menus";

export async function loadSyncEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(SYNC_ENABLED_STORAGE_KEY);
  return Boolean(stored[SYNC_ENABLED_STORAGE_KEY]);
}

export async function saveSyncEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({
    [SYNC_ENABLED_STORAGE_KEY]: enabled,
  });
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const [storedLocal, instanceUid, isSync] = await Promise.all([
    browser.storage.local.get(STORAGE_KEY),
    loadInstanceUid(),
    loadSyncEnabled(),
  ]);
  let config = normalizeConfig(storedLocal[STORAGE_KEY], instanceLabelFromUid(instanceUid));

  if (isSync && browser.storage.sync) {
    try {
      const storedSync = await browser.storage.sync.get(SYNC_CONFIG_KEY);
      const syncData = storedSync[SYNC_CONFIG_KEY];
      if (Array.isArray(syncData) && syncData.length > 0) {
        config = normalizeConfig(
          { ...config, panel: { ...config.panel, menus: syncData } },
          instanceLabelFromUid(instanceUid),
        );
      } else if (isRecord(syncData)) {
        config = normalizeConfig(
          { ...config, panel: { ...config.panel, ...syncData } },
          instanceLabelFromUid(instanceUid),
        );
      }
    } catch (e) {
      console.warn("Failed to load menus from storage.sync:", e);
    }
  }

  return config;
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  const instanceUid = await loadInstanceUid();
  const normalized = normalizeConfig(config, instanceLabelFromUid(instanceUid));
  await browser.storage.local.set({
    [STORAGE_KEY]: normalized,
  });

  const isSync = await loadSyncEnabled();
  if (isSync && browser.storage.sync) {
    try {
      await browser.storage.sync.set({
        [SYNC_CONFIG_KEY]: {
          menus: normalized.panel.menus,
          urlRules: normalized.urlRules,
          dynamicBookmarks: normalized.dynamicBookmarks,
        },
      });
    } catch (e) {
      console.warn("Failed to save menus to storage.sync:", e);
    }
  }
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

  const rawUrlRules = Array.isArray(value.urlRules) ? value.urlRules : [];
  const urlRules: UrlRule[] = rawUrlRules.flatMap((ws) => {
    if (!isRecord(ws)) return [];
    if (typeof ws.uid !== "string" || !ws.uid) return [];
    const name = typeof ws.name === "string" && ws.name.trim() ? ws.name.trim() : "URL rule";
    const patterns = Array.isArray(ws.patterns)
      ? ws.patterns
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.trim())
      : [];
    return [{ uid: ws.uid, name, patterns }];
  });

  const rawDynamic = Array.isArray(value.dynamicBookmarks) ? value.dynamicBookmarks : [];
  const dynamicBookmarks: DynamicBookmark[] = rawDynamic.flatMap((db) => {
    if (!isRecord(db)) return [];
    if (typeof db.uid !== "string" || !db.uid) return [];
    const name = typeof db.name === "string" && db.name.trim() ? db.name.trim() : "Dynamic bookmark";
    const code = typeof db.code === "string" ? db.code : "";
    const urlRuleUids = Array.isArray(db.urlRuleUids)
      ? db.urlRuleUids.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : undefined;
    return [
      {
        uid: db.uid,
        name,
        code,
        ...(urlRuleUids && urlRuleUids.length > 0 ? { urlRuleUids } : {}),
      },
    ];
  });

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
      menus: menus.length > 0 ? menus : [createMenu()],
    },
    urlRules,
    dynamicBookmarks,
  };
}

export function normalizeMenu(value: unknown): StoredMenu | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const uid = typeof value.uid === "string" && value.uid
    ? value.uid
    : crypto.randomUUID();
  const buttonFontSize = value.buttonFontSize !== undefined
    ? normalizeFontSize(value.buttonFontSize)
    : undefined;
  // Only the button font supports auto; a stray auto on the popup coerces to the default.
  const rawPopupFontSize = value.popupFontSize !== undefined
    ? normalizeFontSize(value.popupFontSize)
    : undefined;
  const popupFontSize = isAutoFontSize(rawPopupFontSize) ? DEFAULT_FONT_SIZE : rawPopupFontSize;
  const gap = typeof value.gap === "number" && Number.isFinite(value.gap)
    ? boundedNumber(value.gap, 0, 40, DEFAULT_MENU_GAP)
    : DEFAULT_MENU_GAP;
  const color = typeof value.color === "string" && value.color ? value.color : undefined;
  const tabMode: TabMode | undefined =
    value.tabMode === "newTab" || value.tabMode === "replace"
      ? value.tabMode
      : undefined;
  const expandDirection: ExpandDirection | undefined =
    value.expandDirection === "down" ||
    value.expandDirection === "up" ||
    value.expandDirection === "right" ||
    value.expandDirection === "left"
      ? value.expandDirection
      : undefined;
  const attachmentMode: AttachmentMode = isAttachmentMode(value.attachmentMode)
    ? value.attachmentMode
    : "lastFocused";
  const onTopMode: OnTopMode =
    attachmentMode === "free" || value.onTopMode === "alwaysOnTop"
      ? "alwaysOnTop"
      : "aboveBrowser";
  const enabled = typeof value.enabled === "boolean" ? value.enabled : true;
  const urlRuleUids = Array.isArray(value.urlRuleUids)
    ? value.urlRuleUids.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : undefined;
  const normalizedItems = Array.isArray(value.items)
    ? value.items.map(normalizeStoredMenuItem).filter((i): i is StoredMenuItem => i !== undefined)
    : [];
  let hasMenuToggle = false;
  const items = normalizedItems.filter((item) => {
    if (item.type !== "menuToggle") return true;
    if (hasMenuToggle) return false;
    hasMenuToggle = true;
    return true;
  });

  return {
    attachmentMode,
    ...(color !== undefined ? { color } : {}),
    enabled,
    ...(expandDirection !== undefined ? { expandDirection } : {}),
    ...(buttonFontSize !== undefined ? { buttonFontSize } : {}),
    ...(popupFontSize !== undefined ? { popupFontSize } : {}),
    gap,
    items,
    onTopMode,
    orientation: value.orientation === "row" ? "row" : "column",
    ...(tabMode !== undefined ? { tabMode } : {}),
    uid,
    ...(urlRuleUids && urlRuleUids.length > 0 ? { urlRuleUids } : {}),
  };
}

function normalizePlacement(value: unknown): MenuPlacement | undefined {
  if (!isRecord(value) || !isRecord(value.boundPosition)) {
    return undefined;
  }
  const bound = value.boundPosition;
  if (!isAnchor(bound.anchor)) {
    return undefined;
  }
  const itemWidth = typeof value.itemWidth === "number" && Number.isFinite(value.itemWidth)
    ? boundedNumber(value.itemWidth, 1, 400, DEFAULT_ITEM_WIDTH)
    : undefined;
  const itemHeight = typeof value.itemHeight === "number" && Number.isFinite(value.itemHeight)
    ? boundedNumber(value.itemHeight, 1, 200, DEFAULT_ITEM_HEIGHT)
    : undefined;
  return {
    boundPosition: {
      anchor: bound.anchor,
      offsetX: boundedNumber(bound.offsetX, -10_000, 10_000, 12),
      offsetY: boundedNumber(bound.offsetY, -10_000, 10_000, 12),
    },
    ...(itemHeight !== undefined ? { itemHeight } : {}),
    ...(itemWidth !== undefined ? { itemWidth } : {}),
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

function isAttachmentMode(value: unknown): value is AttachmentMode {
  return value === "lastFocused" || value === "all" || value === "free";
}

function isAnchor(value: unknown): value is MenuAnchor {
  return value === "topLeft" || value === "topRight" || value === "bottomLeft" || value === "bottomRight";
}

export function normalizeStoredMenuItem(value: unknown): StoredMenuItem | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = typeof value.type === "string" && value.type
    ? (value.type as StoredMenuItemType)
    : undefined;
  const uid = typeof value.uid === "string" && value.uid ? value.uid : crypto.randomUUID();

  if (rawType === "space") {
    const units = typeof value.units === "number" && Number.isFinite(value.units)
      ? boundedNumber(value.units, 0.1, 20, 1)
      : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    const transparent = typeof value.transparent === "boolean" ? value.transparent : true;
    return {
      uid,
      type: "space",
      ...(units !== undefined ? { units } : {}),
      ...(color ? { color } : {}),
      transparent,
    };
  }

  if (rawType === "menuToggle") {
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    return {
      uid,
      type: "menuToggle",
      ...(rename ? { rename } : {}),
    };
  }

  if (rawType === "dynamic") {
    const dynamicUid = typeof value.dynamicUid === "string" && value.dynamicUid ? value.dynamicUid : undefined;
    if (!dynamicUid) return undefined;
    const rename = typeof value.rename === "string" && value.rename ? value.rename : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    const tabMode = value.tabMode === "newTab" || value.tabMode === "replace" ? value.tabMode : undefined;
    const showPageTitle = typeof value.showPageTitle === "boolean" ? value.showPageTitle : undefined;
    return {
      uid,
      type: "dynamic",
      dynamicUid,
      ...(rename ? { rename } : {}),
      ...(color ? { color } : {}),
      ...(tabMode ? { tabMode } : {}),
      ...(showPageTitle ? { showPageTitle } : {}),
    };
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
  const tabMode = value.tabMode === "newTab" || value.tabMode === "replace" ? value.tabMode : undefined;
  const expandOnHover = typeof value.expandOnHover === "boolean" ? value.expandOnHover : undefined;
  const includeFolders = value.includeFolders === true ? true : undefined;
  return {
    uid,
    path,
    ...(url ? { url } : {}),
    ...(rawType ? { type: rawType } : {}),
    ...(rename ? { rename } : {}),
    ...(color ? { color } : {}),
    ...(cycleColors && cycleColors.length > 0 ? { cycleColors } : {}),
    ...(tabMode ? { tabMode } : {}),
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(includeFolders ? { includeFolders } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const PLACEMENTS_STORAGE_KEY = "menu_placements";

export type MenuPlacementsMap = Record<string, MenuPlacement>;

export async function loadMenuPlacements(): Promise<MenuPlacementsMap> {
  const stored = await browser.storage.local.get(PLACEMENTS_STORAGE_KEY);
  const raw = stored[PLACEMENTS_STORAGE_KEY];
  if (!isRecord(raw)) {
    return {};
  }
  const result: MenuPlacementsMap = {};
  for (const [uid, placement] of Object.entries(raw)) {
    const normalized = normalizePlacement(placement);
    if (normalized) {
      result[uid] = normalized;
    }
  }
  return result;
}

export async function saveMenuPlacement(menuUid: string, placement: MenuPlacement): Promise<void> {
  const current = await loadMenuPlacements();
  current[menuUid] = placement;
  await browser.storage.local.set({
    [PLACEMENTS_STORAGE_KEY]: current,
  });
}

export async function removeMenuPlacements(menuUid: string): Promise<void> {
  const [placements, freePlacements] = await Promise.all([
    loadMenuPlacements(),
    loadFreePlacements(),
  ]);
  delete placements[menuUid];
  delete freePlacements[menuUid];
  await browser.storage.local.set({
    [PLACEMENTS_STORAGE_KEY]: placements,
    [FREE_PLACEMENTS_STORAGE_KEY]: freePlacements,
  });
}

// Free (detached) menu surface positions: absolute screen coordinates, keyed by
// menuUid. Kept separate from menu_placements (which stores anchor + window-
// relative offsets that have no meaning off a browser window), so switching a
// menu between free and attached modes never overwrites the other.
export const FREE_PLACEMENTS_STORAGE_KEY = "free_placements";

export type FreePlacement = { x: number; y: number };
export type FreePlacementsMap = Record<string, FreePlacement>;

export async function loadFreePlacements(): Promise<FreePlacementsMap> {
  const stored = await browser.storage.local.get(FREE_PLACEMENTS_STORAGE_KEY);
  const raw = stored[FREE_PLACEMENTS_STORAGE_KEY];
  if (!isRecord(raw)) {
    return {};
  }
  const result: FreePlacementsMap = {};
  for (const [uid, pos] of Object.entries(raw)) {
    if (isRecord(pos) && typeof pos.x === "number" && typeof pos.y === "number") {
      result[uid] = { x: pos.x, y: pos.y };
    }
  }
  return result;
}

export async function saveFreePlacement(menuUid: string, position: FreePlacement): Promise<void> {
  const current = await loadFreePlacements();
  current[menuUid] = position;
  await browser.storage.local.set({
    [FREE_PLACEMENTS_STORAGE_KEY]: current,
  });
}

export const WIDGET_ENABLED_STORAGE_KEY = "widget_enabled";

export async function loadWidgetEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get([WIDGET_ENABLED_STORAGE_KEY, "config"]);
  const raw = stored[WIDGET_ENABLED_STORAGE_KEY];
  if (typeof raw === "boolean") {
    return raw;
  }
  const config = stored.config;
  if (isRecord(config) && isRecord(config.desktopWidget) && typeof config.desktopWidget.enabled === "boolean") {
    return config.desktopWidget.enabled;
  }
  return true;
}

export async function saveWidgetEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({
    [WIDGET_ENABLED_STORAGE_KEY]: enabled,
  });
}

export const BOOKMARK_ROOT_PREFIX_KEY = "bookmark_root_prefix";
// The root prefix is an array of folder titles (each a single segment that may
// itself contain "/"), never a "/"-joined string. Empty means "whole tree".
export const DEFAULT_BOOKMARK_ROOT_PREFIX: string[] = [];

export async function loadBookmarkRootPrefix(): Promise<string[]> {
  const stored = await browser.storage.local.get(BOOKMARK_ROOT_PREFIX_KEY);
  const raw = stored[BOOKMARK_ROOT_PREFIX_KEY];
  if (Array.isArray(raw)) {
    return raw
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim());
  }
  return [];
}

export async function saveBookmarkRootPrefix(prefix: string[]): Promise<void> {
  const segments = prefix.map((s) => s.trim()).filter(Boolean);
  await browser.storage.local.set({ [BOOKMARK_ROOT_PREFIX_KEY]: segments });
}

export async function initBookmarkRootPrefix(): Promise<string[]> {
  return DEFAULT_BOOKMARK_ROOT_PREFIX;
}

// Live values of dynamic bookmarks, keyed by dynamic bookmark uid. Local only
// (never synced): they update on every qualifying page visit, so syncing would
// blow the sync quota. This is the parallel of menu_placements/free_placements.
export const DYNAMIC_VALUES_STORAGE_KEY = "dynamic_values";

export interface DynamicValue {
  url: string;
  title: string;
  updatedAt: number;
}

export type DynamicValuesMap = Record<string, DynamicValue>;

export async function loadDynamicValues(): Promise<DynamicValuesMap> {
  const stored = await browser.storage.local.get(DYNAMIC_VALUES_STORAGE_KEY);
  const raw = stored[DYNAMIC_VALUES_STORAGE_KEY];
  if (!isRecord(raw)) {
    return {};
  }
  const result: DynamicValuesMap = {};
  for (const [uid, value] of Object.entries(raw)) {
    if (isRecord(value) && typeof value.url === "string" && typeof value.title === "string") {
      result[uid] = {
        url: value.url,
        title: value.title,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
      };
    }
  }
  return result;
}

export async function saveDynamicValue(uid: string, value: DynamicValue): Promise<void> {
  const current = await loadDynamicValues();
  current[uid] = value;
  await browser.storage.local.set({ [DYNAMIC_VALUES_STORAGE_KEY]: current });
}

export async function removeDynamicValues(uid: string): Promise<void> {
  const current = await loadDynamicValues();
  if (!(uid in current)) return;
  delete current[uid];
  await browser.storage.local.set({ [DYNAMIC_VALUES_STORAGE_KEY]: current });
}
