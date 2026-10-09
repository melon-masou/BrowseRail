import browser from "webextension-polyfill";
import { isExportedSettingsData, type ExportedSettingsData } from "@browserail/protocol";
import { t } from "@browserail/i18n";

const PREFIX = "cloud:";
const MANIFEST_KEY = `${PREFIX}index`;
const CHUNK_BYTES = 6000;
const fields = ["menus", "urlRules", "defaultUrlRuleUid", "dynamicBookmarks", "staticBookmarks", "temporaryBookmarks", "externalActions", "userVariables", "globalCss", "shortcuts", "nativeShortcuts"] as const;
type Field = typeof fields[number];
interface Manifest {
  version: number;
  exportedAt: string;
  fields: Record<Field, string[]>;
}

export function cloudStorageAvailable(): boolean {
  return Boolean(browser.storage.sync);
}

function storage() {
  if (!cloudStorageAvailable()) throw new Error(t("cloud.unavailable"));
  return browser.storage.sync;
}

function split(value: string): string[] {
  const encoder = new TextEncoder();
  const result: string[] = [];
  let part = "";
  let bytes = 2;
  // Measure the stored JSON string, including escaped quotes and backslashes.
  for (const char of value) {
    const size = encoder.encode(JSON.stringify(char)).length - 2;
    if (bytes + size > CHUNK_BYTES) { result.push(part); part = ""; bytes = 2; }
    part += char;
    bytes += size;
  }
  if (part) result.push(part);
  return result;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadCloudSettings(data: ExportedSettingsData): Promise<void> {
  const area = storage();
  const current = await area.get(null);
  const complete = {
    menus: data.menus,
    urlRules: data.urlRules ?? [],
    defaultUrlRuleUid: data.defaultUrlRuleUid ?? "",
    dynamicBookmarks: data.dynamicBookmarks ?? [],
    staticBookmarks: data.staticBookmarks ?? [],
    temporaryBookmarks: data.temporaryBookmarks ?? [],
    externalActions: data.externalActions ?? [],
    userVariables: data.userVariables ?? {},
    globalCss: data.globalCss ?? {},
    shortcuts: data.shortcuts ?? [],
    nativeShortcuts: data.nativeShortcuts ?? [],
  };
  const manifest: Manifest = { version: data.version, exportedAt: data.exportedAt, fields: {} as Record<Field, string[]> };
  const values: Record<string, unknown> = {};
  const retained = new Set([MANIFEST_KEY]);
  for (const field of fields) {
    const value = JSON.stringify(complete[field]);
    const digest = await hash(value);
    manifest.fields[field] = split(value).map((part, index) => {
      const key = `${PREFIX}${field}:${digest}:${index}`;
      retained.add(key);
      if (current[key] !== part) values[key] = part;
      return key;
    });
  }
  // New chunks never overwrite the previous snapshot. Publish them and the
  // manifest together; readers reject cloud updates whose chunks have not arrived.
  await area.set({ ...values, [MANIFEST_KEY]: manifest });
  const obsolete = Object.keys(current).filter(key => (key.startsWith(PREFIX) && !retained.has(key)) || key === "sync_menus");
  if (obsolete.length) {
    try { await area.remove(obsolete); }
    catch (error) { console.warn("Cloud snapshot cleanup failed:", error); }
  }
}

export async function downloadCloudSettings(): Promise<ExportedSettingsData> {
  const stored = await storage().get(null);
  const manifest = stored[MANIFEST_KEY] as Manifest | undefined;
  if (!manifest) throw new Error(t("cloud.empty"));
  if (typeof manifest !== "object" || manifest === null || !manifest.fields || typeof manifest.fields !== "object")
    throw new Error(t("cloud.invalid"));
  const data: Record<string, unknown> = { version: manifest.version, exportedAt: manifest.exportedAt };
  for (const field of fields) {
    const keys = manifest.fields[field];
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== "string" || !key.startsWith(`${PREFIX}${field}:`) || typeof stored[key] !== "string"))
      throw new Error(t("cloud.incomplete"));
    try { data[field] = JSON.parse(keys.map(key => stored[key]).join("")) as unknown; }
    catch { throw new Error(t("cloud.invalid")); }
  }
  if (!isExportedSettingsData(data)) throw new Error(t("cloud.invalid"));
  return data;
}
