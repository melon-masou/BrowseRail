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
import {
  EXTERNAL_RECEIVER_CONFIG, EXTERNAL_RECEIVER_REFRESH, EXTERNAL_RELAY_MESSAGE, isExternalRelay,
  type ExternalReceiverConfigRequest, type ExternalRelay,
} from "@browserail/protocol/content";
import type { ReplyOf } from "@browserail/protocol/message";
import { messageType } from "../../lib/messaging";

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
    if (messageType(message) === EXTERNAL_RECEIVER_CONFIG) {
      const source = userscriptSource(sender, "");
      return (async () => {
        if (!source || source.kind !== "userscript" || !await hasWebsitePermission(source.url)) return { token: "" } satisfies ReplyOf<ExternalReceiverConfigRequest>;
        const authorization = await loadExternalAuthorization();
        return { token: authorization.userscriptEnabled ? authorization.token : "" } satisfies ReplyOf<ExternalReceiverConfigRequest>;
      })();
    }
    if (messageType(message) !== EXTERNAL_RELAY_MESSAGE) return;
    // A malformed relay still goes through the token check, so it is answered as unauthorized.
    const relay = isExternalRelay(message) ? message : undefined;
    const source = userscriptSource(sender, relay?.token ?? "");
    if (!source) return Promise.resolve({ ok: false, error: "unauthorized", errmsg: "API access is not authorized." } satisfies ReplyOf<ExternalRelay>);
    return handler(source, relay?.message) satisfies Promise<ReplyOf<ExternalRelay>>;
  });

  const injection = createExternalInjection();
  let reconciliation = Promise.resolve();
  const reconcile = (): void => {
    reconciliation = reconciliation.then(() => injection.reconcile()).catch(error => console.error("BrowseRail external updates:", error));
  };
  // Bridges cannot read extension storage, so open pages are told to fetch the token again.
  const refreshBridges = async (): Promise<void> => {
    for (const tab of await browser.tabs.query({})) {
      if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: EXTERNAL_RECEIVER_REFRESH }, { frameId: 0 }).catch(() => {});
    }
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[EXTERNAL_AUTHORIZATION_STORAGE_KEY]) return;
    reconcile();
    void refreshBridges().catch(error => console.error("BrowseRail external updates:", error));
  });
  browser.permissions.onAdded.addListener(reconcile);
  browser.permissions.onRemoved.addListener(reconcile);
  reconcile();
}
