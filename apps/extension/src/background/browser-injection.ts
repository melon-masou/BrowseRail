import browser from "webextension-polyfill";
import { loadWebsiteOrigins } from "../site-permissions";

const SCRIPT_ID = "browserail-menus";

export function createBrowserInjection(menus: {
  hasMenus(tabId: number): Promise<boolean>;
  connectedTabs(): Set<number>;
}) {
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
      else if (matchesChanged) {
        await browser.scripting.updateContentScripts([script]);
      }
      const connected = menus.connectedTabs();
      await Promise.all((await browser.tabs.query({})).map(async tab => {
        if (tab.id === undefined || connected.has(tab.id) || !tab.url || !/^https?:/.test(tab.url)) return;
        // Stores and browser UI cannot host extension content scripts.
        const host = new URL(tab.url).hostname;
        if (host === "chromewebstore.google.com" || host === "addons.mozilla.org" || (host === "chrome.google.com" && new URL(tab.url).pathname.startsWith("/webstore"))) return;
        if (!await menus.hasMenus(tab.id)) return;
        try {
          await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["content.js"] });
        } catch (error) { console.error("BrowseRail injection:", error); }
      }));
    },
  };
}
