import { parseExternalUpdate, type ExternalUpdateResult, type JsonValue } from "./protocol";
import type { ExternalAuthorization } from "../config/external-authorization";

export type ExternalSource =
  | { kind: "extension"; id: string }
  | { kind: "userscript"; token: string; url: string };

export function createExternalUpdateHandler(options: {
  loadAuthorization(): Promise<ExternalAuthorization>;
  hasWebsitePermission(url: string): Promise<boolean>;
  updateBookmark(uid: string, url: string): Promise<ExternalUpdateResult>;
  saveData(key: string, data: JsonValue): Promise<void>;
}) {
  return async (source: ExternalSource, message: unknown): Promise<ExternalUpdateResult> => {
    try {
      const authorization = await options.loadAuthorization();
      const authorized = source.kind === "extension"
        ? authorization.extensionsEnabled && authorization.extensionIds.includes(source.id)
        : authorization.userscriptEnabled && authorization.token !== "" && source.token === authorization.token && await options.hasWebsitePermission(source.url);
      if (!authorized) return { ok: false, error: "unauthorized" };
      const parsed = parseExternalUpdate(message);
      if (!parsed) return { ok: false, error: "invalidMessage" };
      if (parsed.type === "bookmark.update") return await options.updateBookmark(parsed.payload.uid, parsed.payload.url);
      await options.saveData(parsed.payload.key, parsed.payload.data);
      return { ok: true };
    } catch { return { ok: false, error: "storageFailed" }; }
  };
}
