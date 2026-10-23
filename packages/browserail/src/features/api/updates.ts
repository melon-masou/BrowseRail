import { matchesUrlRule } from "@browserail/protocol";
import { loadConfig, loadDynamicValue, saveDynamicValue } from "../../lib/config/index";
import { loadExternalAuthorization } from "../../lib/config/external-authorization-store";
import { saveExternalData } from "../../lib/config/external-data";
import { hasWebsitePermission } from "../../lib/browser/site-permissions";
import { createExternalUpdateHandler } from "./handler";
import type { ExternalUpdateResult } from "@browserail/protocol/api";

export function createExternalUpdates(requestSync: () => void) {
  return createExternalUpdateHandler({
    loadAuthorization: loadExternalAuthorization,
    hasWebsitePermission,
    saveData: saveExternalData,
    async recordBookmarkUpdate(uid, source, result): Promise<void> {
      const config = await loadConfig();
      if (!config.dynamicBookmarks.some(bookmark => bookmark.uid === uid && bookmark.type === "external")) return;
      const current = await loadDynamicValue(uid);
      const value = {
        ...current,
        updatedAt: current?.updatedAt ?? 0,
        source: source.kind === "extension" ? source.id : source.url,
      };
      if (result.ok) {
        delete value.error;
        delete value.errmsg;
      } else {
        value.error = result.error;
        value.errmsg = result.errmsg;
      }
      await saveDynamicValue(uid, value);
    },
    async updateBookmark(uid, url): Promise<ExternalUpdateResult> {
      const config = await loadConfig();
      const bookmark = config.dynamicBookmarks.find(value => value.uid === uid);
      if (!bookmark || bookmark.type !== "external") return { ok: false, error: "unknownBookmark", errmsg: "Bookmark is missing or does not use API update." };
      const rule = config.urlRules.find(value => value.uid === bookmark.urlRuleUid);
      if (!rule || !matchesUrlRule(url, rule)) return { ok: false, error: "outsideUrlRule", errmsg: "URL does not match the selected rule." };
      const current = await loadDynamicValue(uid);
      if (current?.url !== url) {
        await saveDynamicValue(uid, { ...current, url, updatedAt: Date.now() });
        requestSync();
      }
      return { ok: true };
    },
  });
}
