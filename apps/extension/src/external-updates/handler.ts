import { parseExternalUpdate, type ExternalUpdateResult, type JsonValue } from "@browserail/protocol/api";
import type { ExternalAuthorization } from "../config/external-authorization";

export type ExternalSource =
  | { kind: "extension"; id: string }
  | { kind: "userscript"; token: string; url: string };

export function createExternalUpdateHandler(options: {
  loadAuthorization(): Promise<ExternalAuthorization>;
  hasWebsitePermission(url: string): Promise<boolean>;
  updateBookmark(uid: string, url: string): Promise<ExternalUpdateResult>;
  recordBookmarkUpdate(uid: string, source: ExternalSource, result: ExternalUpdateResult): Promise<void>;
  saveData(key: string, data: JsonValue): Promise<void>;
}) {
  return async (source: ExternalSource, message: unknown): Promise<ExternalUpdateResult> => {
    try {
      const authorization = await options.loadAuthorization();
      const authorized = source.kind === "extension"
        ? authorization.extensionsEnabled && authorization.extensionIds.includes(source.id)
        : authorization.userscriptEnabled && authorization.token !== "" && source.token === authorization.token && await options.hasWebsitePermission(source.url);
      if (!authorized) return { ok: false, error: "unauthorized", errmsg: "API access is not authorized." };
      const parsed = parseExternalUpdate(message);
      let result: ExternalUpdateResult;
      try {
        if (!parsed) result = { ok: false, error: "invalidMessage", errmsg: "Invalid update data." };
        else if (parsed.type === "bookmark.update") result = await options.updateBookmark(parsed.payload.uid, parsed.payload.url);
        else {
          await options.saveData(parsed.payload.key, parsed.payload.data);
          result = { ok: true };
        }
      } catch (error) { result = { ok: false, error: "storageFailed", errmsg: String(error) }; }
      const uid = parsed?.type === "bookmark.update" ? parsed.payload.uid : !parsed ? bookmarkUid(message) : undefined;
      if (uid) await options.recordBookmarkUpdate(uid, source, result);
      return result;
    } catch (error) { return { ok: false, error: "storageFailed", errmsg: String(error) }; }
  };
}

function bookmarkUid(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== "bookmark.update" || !("payload" in message)) return;
  const payload = message.payload;
  if (!payload || typeof payload !== "object" || !("uid" in payload) || typeof payload.uid !== "string" || !payload.uid || payload.uid.length > 256) return;
  return payload.uid;
}
