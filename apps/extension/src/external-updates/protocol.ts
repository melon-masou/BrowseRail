export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ExternalUpdate =
  | { type: "bookmark.update"; payload: { uid: string; url: string } }
  | { type: "data.update"; payload: { key: string; data: JsonValue } };

export type ExternalUpdateResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalidMessage" | "unknownBookmark" | "outsideUrlRule" | "storageFailed" };

export const EXTERNAL_RELAY_MESSAGE = "externalUpdate";
export const EXTERNAL_RECEIVER_CONFIG = "externalReceiverConfig";
export const MAX_EXTERNAL_MESSAGE_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  const pending = [value];
  while (pending.length) {
    const entry = pending.pop();
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") continue;
    if (typeof entry === "number" && Number.isFinite(entry)) continue;
    if (typeof entry !== "object" || entry === null) return false;
    if (Array.isArray(entry)) pending.push(...entry);
    else if (Object.getPrototypeOf(entry) === Object.prototype || Object.getPrototypeOf(entry) === null) pending.push(...Object.values(entry));
    else return false;
  }
  return true;
}

export function parseExternalUpdate(value: unknown): ExternalUpdate | undefined {
  if (!isRecord(value) || !isRecord(value.payload)) return;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_EXTERNAL_MESSAGE_BYTES) return;
  } catch { return; }
  const payload = value.payload;
  if (value.type === "bookmark.update" && typeof payload.uid === "string" && payload.uid.length > 0 && payload.uid.length <= 256 && typeof payload.url === "string") {
    try {
      const url = new URL(payload.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      return { type: "bookmark.update", payload: { uid: payload.uid, url: url.href } };
    } catch { return; }
  }
  if (value.type === "data.update" && typeof payload.key === "string" && payload.key.length > 0 && payload.key.length <= 256 && isJsonValue(payload.data)) {
    return { type: "data.update", payload: { key: payload.key, data: JSON.parse(JSON.stringify(payload.data)) as JsonValue } };
  }
}
