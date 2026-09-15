import type { AttachmentMode, MenuOrientation, MenuPlacement } from "@browserail/protocol";
import browser from "webextension-polyfill";

import { DEFAULT_DESKTOP_URL, isLocalDesktopUrl } from "./desktop-connection";
import { loadInstanceUid } from "./instance-identity";
import { instanceLabelFromUid } from "./instance-label";

const STORAGE_KEY = "config";

export interface StoredMenuItem {
  bookmarkId: string;
}

export interface StoredMenu {
  items: StoredMenuItem[];
  orientation: MenuOrientation;
  uid: string;
}

export interface ExtensionConfig {
  attachmentMode: AttachmentMode;
  desktopWidget: {
    url: string;
  };
  instanceLabel: string;
  panel: {
    alwaysOnTop: boolean;
    menus: StoredMenu[];
  };
}

const DEFAULT_CONFIG: Omit<ExtensionConfig, "instanceLabel"> = {
  attachmentMode: "lastFocused",
  desktopWidget: {
    url: DEFAULT_DESKTOP_URL,
  },
  panel: {
    alwaysOnTop: true,
    menus: [createMenu("menu-main")],
  },
};

export function createMenu(uid: string = crypto.randomUUID()): StoredMenu {
  return {
    items: [],
    orientation: "row",
    uid,
  };
}

export function defaultMenuPlacement(index = 0): MenuPlacement {
  return {
    anchor: "topLeft",
    height: 40,
    offsetX: 12,
    offsetY: 12 + index * 52,
    width: 288,
  };
}

export async function loadConfig(): Promise<ExtensionConfig> {
  const [stored, instanceUid] = await Promise.all([
    browser.storage.local.get(STORAGE_KEY),
    loadInstanceUid(),
  ]);
  return normalizeConfig(stored[STORAGE_KEY], instanceLabelFromUid(instanceUid));
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  const instanceUid = await loadInstanceUid();
  await browser.storage.local.set({
    [STORAGE_KEY]: normalizeConfig(config, instanceLabelFromUid(instanceUid)),
  });
}

function normalizeConfig(value: unknown, defaultInstanceLabel: string): ExtensionConfig {
  if (!isRecord(value)) {
    return { ...structuredClone(DEFAULT_CONFIG), instanceLabel: defaultInstanceLabel };
  }

  const desktopWidget = isRecord(value.desktopWidget) ? value.desktopWidget : {};
  const panel = isRecord(value.panel) ? value.panel : {};
  const rawMenus = Array.isArray(panel.menus)
    ? panel.menus.flatMap((menu) => normalizeMenu(menu) ?? [])
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
    attachmentMode:
      value.attachmentMode === "active"
        ? "lastFocused"
        : isAttachmentMode(value.attachmentMode)
          ? value.attachmentMode
          : DEFAULT_CONFIG.attachmentMode,
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
      alwaysOnTop:
        typeof panel.alwaysOnTop === "boolean"
          ? panel.alwaysOnTop
          : DEFAULT_CONFIG.panel.alwaysOnTop,
      menus,
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

function normalizeMenu(value: unknown): StoredMenu | undefined {
  if (!isRecord(value) || typeof value.uid !== "string" || !value.uid) {
    return undefined;
  }
  return {
    items: Array.isArray(value.items) ? value.items.filter(isStoredMenuItem) : [],
    orientation: value.orientation === "column" ? "column" : "row",
    uid: value.uid,
  };
}

function normalizePlacement(value: unknown): MenuPlacement | undefined {
  if (!isRecord(value) || !isAnchor(value.anchor)) {
    return undefined;
  }
  return {
    anchor: value.anchor,
    height: boundedNumber(value.height, 32, 1_200, 40),
    offsetX: boundedNumber(value.offsetX, -10_000, 10_000, 12),
    offsetY: boundedNumber(value.offsetY, -10_000, 10_000, 12),
    width: boundedNumber(value.width, 40, 1_600, 288),
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

function isStoredMenuItem(value: unknown): value is StoredMenuItem {
  return isRecord(value) && typeof value.bookmarkId === "string";
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
