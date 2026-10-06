import browser from "webextension-polyfill";
import type { JsonValue } from "../external-updates/protocol";

export const EXTERNAL_DATA_STORAGE_PREFIX = "external_data:";

export function saveExternalData(key: string, data: JsonValue): Promise<void> {
  return browser.storage.local.set({ [EXTERNAL_DATA_STORAGE_PREFIX + key]: data });
}

export async function loadExternalData(key: string): Promise<JsonValue | undefined> {
  const stored = await browser.storage.local.get(EXTERNAL_DATA_STORAGE_PREFIX + key);
  return stored[EXTERNAL_DATA_STORAGE_PREFIX + key] as JsonValue | undefined;
}
