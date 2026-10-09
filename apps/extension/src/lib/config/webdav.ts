import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { isExportedSettingsData, type ExportedSettingsData } from "@browserail/protocol";
import type { WebDavSettings } from "./sync-settings";

function fileUrl(settings: WebDavSettings): URL {
  let url: URL;
  try { url = new URL(settings.url.trim()); }
  catch { throw new Error(t("sync.invalidUrl")); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error(t("sync.invalidUrl"));
  return url;
}

// Call directly from the transfer button's click handler, before any storage I/O.
export async function authorizeWebDav(settings: WebDavSettings): Promise<void> {
  const url = fileUrl(settings);
  if (!await browser.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] }))
    throw new Error(t("sync.permissionDenied"));
}

async function request(settings: WebDavSettings, method: "GET" | "PUT", signal: AbortSignal, data?: ExportedSettingsData): Promise<Response> {
  const url = fileUrl(settings);
  const headers = new Headers();
  if (settings.username || settings.password) {
    if (settings.username.includes(":")) throw new Error(t("sync.invalidUsername"));
    const bytes = new TextEncoder().encode(`${settings.username}:${settings.password}`);
    headers.set("Authorization", `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))}`);
  }
  if (method === "PUT") headers.set("Content-Type", "application/json");
  const response = await fetch(url.href, {
    method, headers, signal, credentials: "omit", redirect: "error", cache: "no-store",
    ...(data ? { body: JSON.stringify(data, null, 2) } : {}),
  });
  if (!response.ok && !(method === "GET" && response.status === 404))
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  return response;
}

export async function readWebDavSettings(settings: WebDavSettings, signal: AbortSignal): Promise<ExportedSettingsData | undefined> {
  const response = await request(settings, "GET", signal);
  if (response.status === 404) return undefined;
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error(t("import.invalidJson")); }
  if (!isExportedSettingsData(data)) throw new Error(t("import.invalidJson"));
  return data;
}

export async function uploadWebDavSettings(settings: WebDavSettings, data: ExportedSettingsData, signal: AbortSignal): Promise<void> {
  await request(settings, "PUT", signal, data);
}
