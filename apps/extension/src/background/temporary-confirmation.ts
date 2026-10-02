import browser, { type Runtime } from "webextension-polyfill";
import type { TemporaryConfirmationResult } from "../page-operations/messages";

interface ConfirmationContext {
  menuUid: string;
  uid: string;
  sourceTabId: number;
  sourceWindowId: number;
}

export async function openTemporaryConfirmation(context: ConfirmationContext): Promise<TemporaryConfirmationResult> {
  if (!browser.action?.openPopup || !browser.action?.setPopup) return "prompt";
  const query = new URLSearchParams({
    menuUid: context.menuUid, uid: context.uid,
    sourceTabId: String(context.sourceTabId), sourceWindowId: String(context.sourceWindowId),
  });
  let opened = false;
  try {
    try {
      await browser.action.setPopup({ tabId: context.sourceTabId, popup: `${browser.runtime.getURL("temporary-confirm.html")}?${query}` });
      await browser.action.openPopup({ windowId: context.sourceWindowId });
      opened = true;
    } finally {
      // Clearing the entry affects future icon clicks, not the open document.
      // Do it now so dismissal or worker suspension cannot leave stale UI.
      await browser.action.setPopup({ tabId: context.sourceTabId, popup: "" });
    }
  } catch (error) {
    if (opened) throw error;
    return "prompt";
  }
  return "opened";
}

export function temporaryConfirmationContext(sender: Runtime.MessageSender): ConfirmationContext {
  if (sender.id !== browser.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) || !sender.url) throw new Error("Invalid confirmation page");
  const url = new URL(sender.url);
  const page = new URL(browser.runtime.getURL("temporary-confirm.html"));
  if (url.protocol !== page.protocol || url.host !== page.host || url.pathname !== page.pathname) throw new Error("Invalid confirmation page");
  const menuUid = url.searchParams.get("menuUid");
  const uid = url.searchParams.get("uid");
  const tabId = url.searchParams.get("sourceTabId");
  const windowId = url.searchParams.get("sourceWindowId");
  if (!menuUid || !uid || !tabId || !windowId || !/^\d+$/.test(tabId) || !/^\d+$/.test(windowId)) throw new Error("Invalid confirmation context");
  const sourceTabId = Number(tabId);
  const sourceWindowId = Number(windowId);
  if (!Number.isSafeInteger(sourceTabId) || !Number.isSafeInteger(sourceWindowId)) throw new Error("Invalid confirmation context");
  return { menuUid, uid, sourceTabId, sourceWindowId };
}
