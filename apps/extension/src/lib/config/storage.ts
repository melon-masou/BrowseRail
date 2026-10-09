import browser from "webextension-polyfill";
import type { TemporaryBookmark } from "@browserail/protocol";
import { loadInstanceUid } from "./instance-identity";
import { instanceLabelFromUid } from "./instance-label";
import { normalizeConfig, type DisplayMode, type ExtensionConfig } from "./model";
import { isRecord } from "./records";

const STORAGE_KEY = "config";
export async function loadConfig(): Promise<ExtensionConfig> {
  const [stored, instanceUid] = await Promise.all([
    browser.storage.local.get(STORAGE_KEY),
    loadInstanceUid(),
  ]);
  return normalizeConfig(stored[STORAGE_KEY], instanceLabelFromUid(instanceUid));
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  const instanceUid = await loadInstanceUid();
  const normalized = normalizeConfig(config, instanceLabelFromUid(instanceUid));
  await browser.storage.local.set({ [STORAGE_KEY]: normalized });
}

export const DISPLAY_MODE_STORAGE_KEY = "display_mode";
export const BROWSER_COLLAPSED_STORAGE_KEY = "browser_menu_collapsed";
export const BROWSER_EDITING_STORAGE_KEY = "browser_menu_editing";

export async function loadBrowserEditing(): Promise<boolean> {
  const stored = await browser.storage.local.get(BROWSER_EDITING_STORAGE_KEY);
  return stored[BROWSER_EDITING_STORAGE_KEY] === true;
}

export async function saveBrowserEditing(editing: boolean): Promise<void> {
  await browser.storage.local.set({ [BROWSER_EDITING_STORAGE_KEY]: editing });
}

export async function loadDisplayMode(): Promise<DisplayMode> {
  const stored = await browser.storage.local.get(DISPLAY_MODE_STORAGE_KEY);
  return stored[DISPLAY_MODE_STORAGE_KEY] === "browser" ? "browser" : "native";
}

export async function saveDisplayMode(mode: DisplayMode): Promise<void> {
  await browser.storage.local.set({ [DISPLAY_MODE_STORAGE_KEY]: mode });
}

export async function loadBrowserCollapsed(): Promise<Record<string, boolean>> {
  const stored = await browser.storage.local.get(BROWSER_COLLAPSED_STORAGE_KEY);
  const raw = stored[BROWSER_COLLAPSED_STORAGE_KEY];
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

export async function toggleBrowserCollapsed(uid: string): Promise<void> {
  const current = await loadBrowserCollapsed();
  current[uid] = !current[uid];
  await browser.storage.local.set({ [BROWSER_COLLAPSED_STORAGE_KEY]: current });
}

export const WIDGET_ENABLED_STORAGE_KEY = "widget_enabled";

export const SHORTCUTS_ENABLED_STORAGE_KEY = "shortcuts_enabled";

export async function loadShortcutsEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(SHORTCUTS_ENABLED_STORAGE_KEY);
  return stored[SHORTCUTS_ENABLED_STORAGE_KEY] !== false;
}

export async function saveShortcutsEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SHORTCUTS_ENABLED_STORAGE_KEY]: enabled });
}

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
// blow the sync quota. Bar configurations are kept local for the same reason.
export const DYNAMIC_VALUE_STORAGE_PREFIX = "dynamic_value:";

export interface DynamicValue {
  url?: string;
  title?: string;
  note?: string;
  updatedAt: number;
  source?: string;
  error?: string;
  errmsg?: string;
}

export type DynamicValuesMap = Record<string, DynamicValue>;

function normalizeDynamicValue(value: unknown): DynamicValue | undefined {
  if (!isRecord(value) || (typeof value.url !== "string" && typeof value.note !== "string" && typeof value.source !== "string")) return;
  return {
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.note === "string" ? { note: value.note } : {}),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(typeof value.errmsg === "string" ? { errmsg: value.errmsg } : {}),
  };
}

export async function loadDynamicValue(uid: string): Promise<DynamicValue | undefined> {
  const key = DYNAMIC_VALUE_STORAGE_PREFIX + uid;
  const stored = await browser.storage.local.get(key);
  return normalizeDynamicValue(stored[key]);
}

export async function loadDynamicValues(uids?: readonly string[]): Promise<DynamicValuesMap> {
  const targets = uids ?? (await loadConfig()).dynamicBookmarks.map(bookmark => bookmark.uid);
  if (!targets.length) return {};
  const stored = await browser.storage.local.get(targets.map(uid => DYNAMIC_VALUE_STORAGE_PREFIX + uid));
  const result: DynamicValuesMap = {};
  for (const uid of targets) {
    const value = normalizeDynamicValue(stored[DYNAMIC_VALUE_STORAGE_PREFIX + uid]);
    if (value) result[uid] = value;
  }
  return result;
}

export function saveDynamicValue(uid: string, value: DynamicValue): Promise<void> {
  return browser.storage.local.set({ [DYNAMIC_VALUE_STORAGE_PREFIX + uid]: value });
}

export function removeDynamicValues(uid: string): Promise<void> {
  return browser.storage.local.remove(DYNAMIC_VALUE_STORAGE_PREFIX + uid);
}

const TEMPORARY_VALUES_STORAGE_KEY = "temporary_bookmark_values";
const TEMPORARY_NOTES_STORAGE_KEY = "temporary_bookmark_notes";

export async function loadTemporaryValues(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(TEMPORARY_VALUES_STORAGE_KEY);
  const raw = stored[TEMPORARY_VALUES_STORAGE_KEY];
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  );
}

export async function loadTemporaryNotes(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(TEMPORARY_NOTES_STORAGE_KEY);
  const raw = stored[TEMPORARY_NOTES_STORAGE_KEY];
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  );
}

export async function saveTemporaryValue(uid: string, url: string, note = ""): Promise<void> {
  const values = await loadTemporaryValues();
  const notes = await loadTemporaryNotes();
  values[uid] = url;
  if (note.trim()) {
    notes[uid] = note.trim();
  } else {
    delete notes[uid];
  }
  await browser.storage.local.set({
    [TEMPORARY_VALUES_STORAGE_KEY]: values,
    [TEMPORARY_NOTES_STORAGE_KEY]: notes,
  });
}

export async function clearTemporaryValue(uid: string): Promise<void> {
  const values = await loadTemporaryValues();
  const notes = await loadTemporaryNotes();
  delete values[uid];
  delete notes[uid];
  await browser.storage.local.set({ [TEMPORARY_VALUES_STORAGE_KEY]: values, [TEMPORARY_NOTES_STORAGE_KEY]: notes });
}

export async function pruneTemporaryValues(definitions: TemporaryBookmark[]): Promise<void> {
  const retainedUids = new Set(definitions.map(entry => entry.uid));
  const values = await loadTemporaryValues();
  const notes = await loadTemporaryNotes();
  const retainedValues = Object.fromEntries(Object.entries(values).filter(([uid]) => retainedUids.has(uid)));
  const retainedNotes = Object.fromEntries(Object.entries(notes).filter(([uid]) => retainedUids.has(uid)));
  if (Object.keys(retainedValues).length !== Object.keys(values).length || Object.keys(retainedNotes).length !== Object.keys(notes).length) {
    await browser.storage.local.set({
      [TEMPORARY_VALUES_STORAGE_KEY]: retainedValues,
      [TEMPORARY_NOTES_STORAGE_KEY]: retainedNotes,
    });
  }
}
