import type {
  AttachmentMode,
  ExpandDirection,
  MenuFontSize,
  MenuOrientation,
  MenuPlacement,
  OnTopMode,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import { DEFAULT_DESKTOP_URL, isLocalDesktopUrl } from "./desktop-connection";
import { loadInstanceUid } from "./instance-identity";
import { instanceLabelFromUid } from "./instance-label";

const STORAGE_KEY = "config";

export type StoredMenuItemType = "bookmark" | "folder" | "flattenFolder" | "space" | (string & {});

export type TabMode = "replace" | "newTab";

export interface StoredMenuItem {
  bookmarkId: string;
  path?: string[];
  url?: string;
  color?: string;
  emoji?: string;
  rename?: string;
  type?: StoredMenuItemType;
  expandOnHover?: boolean;
  tabMode?: TabMode;
  units?: number;
  transparent?: boolean;
}

export interface StoredMenu {
  attachmentMode?: AttachmentMode;
  color?: string;
  expandDirection?: ExpandDirection;
  fontSize?: MenuFontSize;
  gap?: number;
  items: StoredMenuItem[];
  onTopMode?: OnTopMode;
  orientation: MenuOrientation;
  tabMode?: TabMode;
  uid: string;
}

export interface ExtensionConfig {
  desktopWidget: {
    url: string;
  };
  instanceLabel: string;
  panel: {
    menus: StoredMenu[];
  };
}

export const DEFAULT_FONT_SIZE = 13;

export function normalizeFontSize(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(8, Math.min(48, Math.round(value)));
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
    fontSize: DEFAULT_FONT_SIZE,
    gap: DEFAULT_MENU_GAP_PERCENT,
    items: [],
    onTopMode: "aboveBrowser",
    orientation: "row",
    uid,
  };
}

const DEFAULT_CONFIG: Omit<ExtensionConfig, "instanceLabel"> = {
  desktopWidget: {
    url: DEFAULT_DESKTOP_URL,
  },
  panel: {
    menus: [createMenu("menu-main")],
  },
};

export const DEFAULT_ITEM_WIDTH = 84;
export const DEFAULT_ITEM_HEIGHT = 36;
export const MENU_GAP = DEFAULT_MENU_GAP;

export function getItemDimensions(fontSize: MenuFontSize = DEFAULT_FONT_SIZE): { itemWidth: number; itemHeight: number } {
  const fs = normalizeFontSize(fontSize);
  const itemHeight = Math.max(26, Math.round(fs * 2.7));
  const itemWidth = Math.max(54, Math.round(fs * 6.5));
  return { itemWidth, itemHeight };
}

export function defaultMenuPlacement(
  index = 0,
  orientation: MenuOrientation = "row",
  itemCount = 1,
  fontSize: MenuFontSize = DEFAULT_FONT_SIZE,
  gapPercent = DEFAULT_MENU_GAP_PERCENT,
): MenuPlacement {
  const { itemWidth, itemHeight } = getItemDimensions(fontSize);
  const count = Math.max(1, itemCount);
  const buttonDim = itemHeight;
  const gapPx = calculateGapPx(buttonDim, gapPercent);
  const width = orientation === "row" ? count * itemWidth + (count - 1) * gapPx : itemWidth;
  const height = orientation === "column" ? count * itemHeight + (count - 1) * gapPx : itemHeight;

  return {
    anchor: "topLeft",
    fontSize: normalizeFontSize(fontSize),
    gap: gapPx,
    height,
    itemHeight,
    itemWidth,
    offsetX: 12,
    offsetY: 12 + index * (height + 12),
    width,
  };
}

export function resolveMenuPlacement(
  storedPlacement: MenuPlacement | undefined,
  index = 0,
  orientation: MenuOrientation = "row",
  _itemCount = 1,
  fontSize: MenuFontSize = DEFAULT_FONT_SIZE,
  gapPercent = DEFAULT_MENU_GAP_PERCENT,
): MenuPlacement {
  const defaultDim = getItemDimensions(fontSize);
  const effectiveGapPercent = gapPercent !== undefined ? gapPercent : DEFAULT_MENU_GAP_PERCENT;
  const effectiveGapPx = calculateGapPx(defaultDim.itemHeight, effectiveGapPercent);

  // A never-customized menu still needs default anchor/offsets and a default per-button
  // size; a remembered placement supplies those from the last desktop customization.
  const base =
    storedPlacement ?? defaultMenuPlacement(index, orientation, 1, fontSize, effectiveGapPercent);

  const itemWidth =
    typeof base.itemWidth === "number" && base.itemWidth > 0 ? base.itemWidth : defaultDim.itemWidth;
  const itemHeight =
    typeof base.itemHeight === "number" && base.itemHeight > 0
      ? base.itemHeight
      : defaultDim.itemHeight;

  // The extension only carries the per-button size + placement. The TOTAL width/height
  // is NOT computed or stored here — the desktop derives it from itemWidth/itemHeight ×
  // item count on sync (and overwrites these zeros), so a stale total can never squeeze
  // the buttons or drift when items are added/removed.
  return {
    anchor: base.anchor,
    offsetX: base.offsetX,
    offsetY: base.offsetY,
    fontSize: normalizeFontSize(fontSize),
    gap: effectiveGapPx,
    itemWidth,
    itemHeight,
    width: 0,
    height: 0,
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
      const syncMenus = storedSync[SYNC_CONFIG_KEY];
      if (Array.isArray(syncMenus) && syncMenus.length > 0) {
        config = normalizeConfig(
          { ...config, panel: { menus: syncMenus } },
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
        [SYNC_CONFIG_KEY]: normalized.panel.menus,
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
  const legacyAttachmentMode =
    value.attachmentMode === "active"
      ? "lastFocused"
      : isAttachmentMode(value.attachmentMode)
        ? value.attachmentMode
        : undefined;
  const legacyOnTopMode =
    panel.onTopMode === "alwaysOnTop" || panel.onTopMode === "aboveBrowser"
      ? (panel.onTopMode as OnTopMode)
      : undefined;

  const rawMenus = Array.isArray(panel.menus)
    ? panel.menus.flatMap((menu) => {
        const norm = normalizeMenu(menu);
        if (!norm) return [];
        if (isRecord(menu)) {
          if (!menu.attachmentMode && legacyAttachmentMode) {
            norm.attachmentMode = legacyAttachmentMode;
          }
          if (!menu.onTopMode && legacyOnTopMode) {
            norm.onTopMode = legacyOnTopMode;
          }
        }
        return [norm];
      })
    : migrateLegacyMenu(Array.isArray(panel.layout) ? panel : value);
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
      menus: menus.length > 0 ? menus : [createMenu("menu-main")],
    },
  };
}

function migrateLegacyMenu(panel: Record<string, unknown>): StoredMenu[] {
  const menu = createMenu("menu-main");
  if (!Array.isArray(panel.layout)) {
    return [menu];
  }

  const cells = panel.layout.filter(isRecord).toSorted(
    (left, right) =>
      numericValue(left.row) - numericValue(right.row) ||
      numericValue(left.column) - numericValue(right.column),
  );
  menu.items = cells.flatMap((cell) =>
    typeof cell.bookmarkId === "string" ? [{ bookmarkId: cell.bookmarkId }] : [],
  );
  menu.orientation = "row";
  return [menu];
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeMenu(value: unknown): StoredMenu | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const uid = typeof value.uid === "string" && value.uid
    ? value.uid
    : typeof (value as { id?: unknown }).id === "string" && (value as { id: string }).id
      ? (value as { id: string }).id
      : `menu-${Math.random().toString(36).slice(2, 9)}`;
  const fontSize = value.fontSize !== undefined ? normalizeFontSize(value.fontSize) : undefined;
  const gap = typeof value.gap === "number" && Number.isFinite(value.gap)
    ? boundedNumber(value.gap, 0, 40, DEFAULT_MENU_GAP)
    : DEFAULT_MENU_GAP;
  const color = typeof value.color === "string" && value.color ? value.color : undefined;
  const tabMode: TabMode | undefined =
    value.tabMode === "newTab" || value.tabMode === "replace"
      ? value.tabMode
      : undefined;
  const expandDirection: ExpandDirection | undefined =
    value.expandDirection === "down" || value.expandDirection === "right"
      ? value.expandDirection
      : undefined;
  const attachmentMode: AttachmentMode =
    value.attachmentMode === "all" || value.attachmentMode === "lastFocused" || value.attachmentMode === "none"
      ? value.attachmentMode
      : "lastFocused";
  const onTopMode: OnTopMode =
    value.onTopMode === "alwaysOnTop" ? "alwaysOnTop" : "aboveBrowser";
  return {
    attachmentMode,
    ...(color !== undefined ? { color } : {}),
    ...(expandDirection !== undefined ? { expandDirection } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    gap,
    items: Array.isArray(value.items)
      ? value.items.map(normalizeStoredMenuItem).filter((i): i is StoredMenuItem => i !== undefined)
      : [],
    onTopMode,
    orientation: value.orientation === "column" ? "column" : "row",
    ...(tabMode !== undefined ? { tabMode } : {}),
    uid,
  };
}

function normalizePlacement(value: unknown): MenuPlacement | undefined {
  if (!isRecord(value) || !isAnchor(value.anchor)) {
    return undefined;
  }
  const CUSTOMIZE_ICON_SIZE = 26;
  const itemWidth = typeof value.itemWidth === "number" && Number.isFinite(value.itemWidth)
    ? boundedNumber(value.itemWidth, 1, 400, DEFAULT_ITEM_WIDTH)
    : undefined;
  const itemHeight = typeof value.itemHeight === "number" && Number.isFinite(value.itemHeight)
    ? boundedNumber(value.itemHeight, 1, 200, DEFAULT_ITEM_HEIGHT)
    : undefined;
  const fontSize = value.fontSize !== undefined ? normalizeFontSize(value.fontSize) : undefined;
  const gap = typeof value.gap === "number" && Number.isFinite(value.gap)
    ? boundedNumber(value.gap, 0, 40, DEFAULT_MENU_GAP)
    : undefined;
  return {
    anchor: value.anchor,
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(gap !== undefined ? { gap } : {}),
    height: boundedNumber(value.height, CUSTOMIZE_ICON_SIZE, 1_600, DEFAULT_ITEM_HEIGHT),
    ...(itemHeight !== undefined ? { itemHeight } : {}),
    ...(itemWidth !== undefined ? { itemWidth } : {}),
    offsetX: boundedNumber(value.offsetX, -10_000, 10_000, 12),
    offsetY: boundedNumber(value.offsetY, -10_000, 10_000, 12),
    width: boundedNumber(value.width, CUSTOMIZE_ICON_SIZE, 2_000, DEFAULT_ITEM_WIDTH),
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
  return value === "none" || value === "lastFocused" || value === "all";
}

function isAnchor(value: unknown): value is MenuPlacement["anchor"] {
  return value === "topLeft" || value === "topRight" || value === "bottomLeft" || value === "bottomRight";
}

export function normalizeStoredMenuItem(value: unknown): StoredMenuItem | undefined {
  if (!isRecord(value)) return undefined;
  const rawType = typeof value.type === "string" && value.type
    ? (value.type as StoredMenuItemType)
    : undefined;

  if (rawType === "space") {
    const bookmarkId = typeof value.bookmarkId === "string" && value.bookmarkId
      ? value.bookmarkId
      : `space-${crypto.randomUUID()}`;
    const units = typeof value.units === "number" && Number.isFinite(value.units)
      ? boundedNumber(value.units, 0.1, 20, 1)
      : undefined;
    const color = typeof value.color === "string" && value.color ? value.color : undefined;
    const transparent = typeof value.transparent === "boolean" ? value.transparent : true;
    return {
      bookmarkId,
      type: "space",
      ...(units !== undefined ? { units } : {}),
      ...(color ? { color } : {}),
      transparent,
    };
  }

  const bookmarkId = typeof value.bookmarkId === "string" ? value.bookmarkId : "";
  const path = Array.isArray(value.path) && value.path.every((p) => typeof p === "string")
    ? value.path
    : undefined;
  if (!bookmarkId && path === undefined) {
    return undefined;
  }
  const rename = typeof value.rename === "string" && value.rename
    ? value.rename
    : typeof (value as { emoji?: unknown }).emoji === "string" && (value as { emoji: string }).emoji
      ? (value as { emoji: string }).emoji
      : undefined;
  const color = typeof value.color === "string" && value.color ? value.color : undefined;
  const tabMode = value.tabMode === "newTab" || value.tabMode === "replace" ? value.tabMode : undefined;
  const expandOnHover = typeof value.expandOnHover === "boolean" ? value.expandOnHover : undefined;
  return {
    bookmarkId,
    ...(path !== undefined ? { path } : {}),
    ...(rawType ? { type: rawType } : {}),
    ...(rename ? { rename } : {}),
    ...(color ? { color } : {}),
    ...(tabMode ? { tabMode } : {}),
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
  };
}

function isStoredMenuItem(value: unknown): value is StoredMenuItem {
  return (
    isRecord(value) &&
    (typeof value.bookmarkId === "string" || Array.isArray(value.path)) &&
    (value.path === undefined || (Array.isArray(value.path) && value.path.every((p) => typeof p === "string"))) &&
    (value.url === undefined || typeof value.url === "string") &&
    (value.color === undefined || typeof value.color === "string") &&
    (value.rename === undefined || typeof value.rename === "string" || typeof (value as { emoji?: unknown }).emoji === "string") &&
    (value.expandOnHover === undefined || typeof value.expandOnHover === "boolean") &&
    (value.tabMode === undefined || value.tabMode === "replace" || value.tabMode === "newTab") &&
    (value.type === undefined || typeof value.type === "string")
  );
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
export const DEFAULT_BOOKMARK_ROOT_PREFIX = "/";

export async function loadBookmarkRootPrefix(): Promise<string> {
  const stored = await browser.storage.local.get(BOOKMARK_ROOT_PREFIX_KEY);
  const raw = stored[BOOKMARK_ROOT_PREFIX_KEY];
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed === "/书签栏" || trimmed === "/Bookmarks bar") {
      return DEFAULT_BOOKMARK_ROOT_PREFIX;
    }
    return trimmed;
  }
  return DEFAULT_BOOKMARK_ROOT_PREFIX;
}

export async function saveBookmarkRootPrefix(prefix: string): Promise<void> {
  await browser.storage.local.set({
    [BOOKMARK_ROOT_PREFIX_KEY]: prefix.trim() || DEFAULT_BOOKMARK_ROOT_PREFIX,
  });
}

export async function initBookmarkRootPrefix(): Promise<string> {
  return DEFAULT_BOOKMARK_ROOT_PREFIX;
}

