import { extension } from "../runtime";
import { loadWebsiteOrigins } from "@browserail/browserail/lib/browser/site-permissions";

import { loadExternalAuthorization } from "@browserail/browserail/lib/config/external-authorization-store";

const MENU_SCRIPT_ID = "browserail-menus";

export function createMenuScriptRegistration() {
  return {
    async reconcile(active: boolean): Promise<void> {
      const origins = active ? await loadWebsiteOrigins() : [];
      const registered = (await extension.scripting.getRegisteredContentScripts({ ids: [MENU_SCRIPT_ID] }))[0];
      if (!origins.length) {
        if (registered) await extension.scripting.unregisterContentScripts({ ids: [MENU_SCRIPT_ID] });
        return;
      }
      const script = { id: MENU_SCRIPT_ID, matches: origins, js: ["content.js"], runAt: "document_start" as const, allFrames: false };
      const matchesChanged = JSON.stringify([...(registered?.matches ?? [])].sort()) !== JSON.stringify([...origins].sort());
      if (!registered) await extension.scripting.registerContentScripts([script]);
      else if (matchesChanged) await extension.scripting.updateContentScripts([script]);
    },
  };
}

const EXTERNAL_SCRIPT_ID = "browserail-external-updates";

export function createExternalUpdateScriptRegistration() {
  return {
    async reconcile(): Promise<void> {
      const authorization = await loadExternalAuthorization();
      const origins = authorization.userscriptEnabled && authorization.token ? await loadWebsiteOrigins() : [];
      const registered = (await extension.scripting.getRegisteredContentScripts({ ids: [EXTERNAL_SCRIPT_ID] }))[0];
      if (!origins.length) {
        if (registered) await extension.scripting.unregisterContentScripts({ ids: [EXTERNAL_SCRIPT_ID] });
        return;
      }
      const script = { id: EXTERNAL_SCRIPT_ID, matches: origins, js: ["external-updates.js"], runAt: "document_start" as const, allFrames: false };
      if (!registered) await extension.scripting.registerContentScripts([script]);
      else if (JSON.stringify([...(registered.matches ?? [])].sort()) !== JSON.stringify([...origins].sort())) await extension.scripting.updateContentScripts([script]);
    },
  };
}
