import browser, { type Runtime } from "webextension-polyfill";
import { matchesUrlRule } from "@browserail/protocol";
import { loadConfig, loadDynamicValue, saveDynamicValue } from "../../lib/config";
import { loadExternalAuthorization } from "../../lib/config/external-authorization-store";
import { EXTERNAL_AUTHORIZATION_STORAGE_KEY } from "../../lib/config/external-authorization";
import { saveExternalData } from "../../lib/config/external-data";
import { hasWebsitePermission } from "../../lib/browser/site-permissions";
import { createExternalUpdateHandler, type ExternalSource } from "./handler";
import { createExternalInjection } from "../injection/bridge";
import type { ExternalUpdateResult } from "@browserail/protocol/api";
import { EXTERNAL_RECEIVER_CONFIG, EXTERNAL_RELAY_MESSAGE } from "../../content/bridge/messages";

function userscriptSource(sender: Runtime.MessageSender, token: string): ExternalSource | undefined {
  if (sender.id !== browser.runtime.id || typeof sender.tab?.id !== "number" || sender.frameId !== 0 || typeof sender.url !== "string") return;
  return { kind: "userscript", token, url: sender.url };
}

export function initExternalUpdates(requestSync: () => void): void {
  const handler = createExternalUpdateHandler({
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

  browser.runtime.onMessageExternal.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if (!sender.id) return Promise.resolve({ ok: false, error: "unauthorized", errmsg: "API access is not authorized." } satisfies ExternalUpdateResult);
    return handler({ kind: "extension", id: sender.id }, message);
  });
  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    if (message.type === EXTERNAL_RECEIVER_CONFIG) {
      const source = userscriptSource(sender, "");
      return (async () => {
        if (!source || source.kind !== "userscript" || !await hasWebsitePermission(source.url)) return { token: "" };
        const authorization = await loadExternalAuthorization();
        return { token: authorization.userscriptEnabled ? authorization.token : "" };
      })();
    }
    if (message.type !== EXTERNAL_RELAY_MESSAGE) return;
    const source = userscriptSource(sender, "token" in message && typeof message.token === "string" ? message.token : "");
    if (!source) return Promise.resolve({ ok: false, error: "unauthorized", errmsg: "API access is not authorized." } satisfies ExternalUpdateResult);
    return handler(source, "message" in message ? message.message : undefined);
  });

  const injection = createExternalInjection();
  let reconciliation = Promise.resolve();
  const reconcile = (): void => {
    reconciliation = reconciliation.then(() => injection.reconcile()).catch(error => console.error("BrowseRail external updates:", error));
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[EXTERNAL_AUTHORIZATION_STORAGE_KEY]) reconcile();
  });
  browser.permissions.onAdded.addListener(reconcile);
  browser.permissions.onRemoved.addListener(reconcile);
  reconcile();
}
