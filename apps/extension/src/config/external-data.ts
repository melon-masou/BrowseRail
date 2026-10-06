import browser from "webextension-polyfill";
import type { JsonValue } from "@browserail/protocol/api";

export const EXTERNAL_DATA_STORAGE_PREFIX = "external_data:";

export function saveExternalData(key: string, data: JsonValue): Promise<void> {
  return browser.storage.local.set({ [EXTERNAL_DATA_STORAGE_PREFIX + key]: data });
}

export async function loadExternalData(key: string): Promise<JsonValue | undefined> {
  const stored = await browser.storage.local.get(EXTERNAL_DATA_STORAGE_PREFIX + key);
  return stored[EXTERNAL_DATA_STORAGE_PREFIX + key] as JsonValue | undefined;
}

export async function listExternalData(): Promise<[string, JsonValue][]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX))
    .map(([key, value]) => [key.slice(EXTERNAL_DATA_STORAGE_PREFIX.length), value as JsonValue]);
}

export function removeExternalData(key: string): Promise<void> {
  return browser.storage.local.remove(EXTERNAL_DATA_STORAGE_PREFIX + key);
}
