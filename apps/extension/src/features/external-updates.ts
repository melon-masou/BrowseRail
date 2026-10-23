import type { MessageSender } from "@browserail/runtime-adapter";
import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import { extension } from "../runtime";
import { loadExternalAuthorization } from "@browserail/browserail/lib/config/external-authorization-store";
import { EXTERNAL_AUTHORIZATION_STORAGE_KEY } from "@browserail/browserail/lib/config/external-authorization";
import { hasWebsitePermission } from "@browserail/browserail/lib/browser/site-permissions";
import type { ExternalSource } from "@browserail/browserail/features/api/handler";
import { createExternalUpdates } from "@browserail/browserail/features/api/updates";
import { createExternalUpdateScriptRegistration } from "./content-scripts";
import type { ExternalUpdateResult } from "@browserail/protocol/api";
import {
  EXTERNAL_RECEIVER_CONFIG, EXTERNAL_RECEIVER_REFRESH, EXTERNAL_RELAY_MESSAGE, isExternalRelay,
  type ExternalReceiverConfigRequest, type ExternalRelay,
} from "@browserail/protocol/content";
import type { ReplyOf } from "@browserail/protocol/message";
import { messageType } from "@browserail/browserail/lib/messaging";

function userscriptSource(sender: MessageSender, token: string): ExternalSource | undefined {
  if (sender.id !== getRuntimeAdapter().messaging.id || typeof sender.tab?.id !== "number" || sender.frameId !== 0 || typeof sender.url !== "string") return;
  return { kind: "userscript", token, url: sender.url };
}

export function initExternalUpdates(requestSync: () => void): void {
  const handler = createExternalUpdates(requestSync);

  extension.runtime.onMessageExternal.addListener((message: unknown, sender: MessageSender) => {
    if (!sender.id) return Promise.resolve({ ok: false, error: "unauthorized", errmsg: "API access is not authorized." } satisfies ExternalUpdateResult);
    return handler({ kind: "extension", id: sender.id }, message);
  });
  getRuntimeAdapter().messaging.onMessage.addListener((message: unknown, sender: MessageSender) => {
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

  const injection = createExternalUpdateScriptRegistration();
  let reconciliation = Promise.resolve();
  const reconcile = (): void => {
    reconciliation = reconciliation.then(() => injection.reconcile()).catch(error => console.error("BrowseRail external updates:", error));
  };
  // Bridges cannot read extension storage, so open pages are told to fetch the token again.
  const refreshBridges = async (): Promise<void> => {
    for (const tab of await getRuntimeAdapter().navigation.query({})) {
      if (tab.id !== undefined) void getRuntimeAdapter().messaging.sendToTab(tab.id, { type: EXTERNAL_RECEIVER_REFRESH }, { frameId: 0 }).catch(() => {});
    }
  };
  getRuntimeAdapter().storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[EXTERNAL_AUTHORIZATION_STORAGE_KEY]) return;
    reconcile();
    void refreshBridges().catch(error => console.error("BrowseRail external updates:", error));
  });
  extension.permissionEvents.onAdded.addListener(reconcile);
  extension.permissionEvents.onRemoved.addListener(reconcile);
  reconcile();
}
