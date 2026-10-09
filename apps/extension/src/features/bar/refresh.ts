import browser from "webextension-polyfill";
import { BAR_REFRESH_MESSAGE } from "@browserail/protocol/content";

export async function requestBrowserMenuRefresh(tabId: number): Promise<void> {
  // A toolbar action can originate from a page without an injected menu.
  await browser.tabs.sendMessage(tabId, { type: BAR_REFRESH_MESSAGE }, { frameId: 0 }).catch(() => {});
}
