import browser from "webextension-polyfill";
import { loadWebsiteOrigins } from "../browser/site-permissions";

const SCRIPT_ID = "browserail-menus";

export function createBrowserInjection() {
  return {
    async reconcile(active: boolean): Promise<void> {
      const origins = active ? await loadWebsiteOrigins() : [];
      const registered = (await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }))[0];
      if (!origins.length) {
        if (registered) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
        return;
      }
      const script = { id: SCRIPT_ID, matches: origins, js: ["content.js"], runAt: "document_start" as const, allFrames: false };
      const matchesChanged = JSON.stringify([...(registered?.matches ?? [])].sort()) !== JSON.stringify([...origins].sort());
      if (!registered) await browser.scripting.registerContentScripts([script]);
      else if (matchesChanged) await browser.scripting.updateContentScripts([script]);
    },
  };
}
