import { extension } from "../../runtime";
import { loadWebsiteOrigins } from "../../lib/browser/site-permissions";
import { loadExternalAuthorization } from "../../lib/config/external-authorization-store";

const SCRIPT_ID = "browserail-external-updates";

export function createExternalInjection() {
  return {
    async reconcile(): Promise<void> {
      const authorization = await loadExternalAuthorization();
      const origins = authorization.userscriptEnabled && authorization.token ? await loadWebsiteOrigins() : [];
      const registered = (await extension.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }))[0];
      if (!origins.length) {
        if (registered) await extension.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
        return;
      }
      const script = { id: SCRIPT_ID, matches: origins, js: ["external-updates.js"], runAt: "document_start" as const, allFrames: false };
      if (!registered) await extension.scripting.registerContentScripts([script]);
      else if (JSON.stringify([...(registered.matches ?? [])].sort()) !== JSON.stringify([...origins].sort())) await extension.scripting.updateContentScripts([script]);
    },
  };
}
