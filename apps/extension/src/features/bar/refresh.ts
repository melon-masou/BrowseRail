import browser from "webextension-polyfill";

export async function requestBrowserMenuRefresh(tabId: number): Promise<void> {
  // A toolbar action can originate from a page without an injected menu.
  await browser.tabs.sendMessage(tabId, { type: "browserMenusRefresh" }, { frameId: 0 }).catch(() => {});
}
