import browser, { type Runtime } from "webextension-polyfill";
import type { TemporaryConfirmationResult } from "@browserail/protocol/content";

interface ConfirmationSource {
  sourceTabId: number;
  sourceWindowId: number;
}

interface ConfirmationContext extends ConfirmationSource {
  menuUid: string;
  uid: string;
}

export async function openTemporaryConfirmation(context: ConfirmationContext): Promise<TemporaryConfirmationResult> {
  return openConfirmationPopup(context, { menuUid: context.menuUid, uid: context.uid });
}

export async function openStaticConfirmation(source: ConfirmationSource, bookmark: { name: string; url: string }): Promise<void> {
  const result = await openConfirmationPopup(source, { kind: "static", name: bookmark.name, url: bookmark.url });
  if (result !== "opened") throw new Error("Bookmark confirmation popup is unavailable");
}

async function openConfirmationPopup(source: ConfirmationSource, fields: Record<string, string>): Promise<TemporaryConfirmationResult> {
  if (!browser.action?.openPopup || !browser.action?.setPopup) return "prompt";
  const query = new URLSearchParams({
    ...fields,
    sourceTabId: String(source.sourceTabId), sourceWindowId: String(source.sourceWindowId),
  });
  let opened = false;
  try {
    try {
      await browser.action.setPopup({ tabId: source.sourceTabId, popup: `${browser.runtime.getURL("temporary-confirm.html")}?${query}` });
      await browser.action.openPopup({ windowId: source.sourceWindowId });
      opened = true;
    } finally {
      // Clearing the entry affects future icon clicks, not the open document.
      // Do it now so dismissal or worker suspension cannot leave stale UI.
      await browser.action.setPopup({ tabId: source.sourceTabId, popup: "" });
    }
  } catch (error) {
    if (opened) throw error;
    return "prompt";
  }
  return "opened";
}

function confirmationPage(sender: Runtime.MessageSender): URL {
  if (sender.id !== browser.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0) || !sender.url) throw new Error("Invalid confirmation page");
  const url = new URL(sender.url);
  const page = new URL(browser.runtime.getURL("temporary-confirm.html"));
  if (url.protocol !== page.protocol || url.host !== page.host || url.pathname !== page.pathname) throw new Error("Invalid confirmation page");
  return url;
}

function confirmationSource(url: URL): ConfirmationSource {
  const tabId = url.searchParams.get("sourceTabId");
  const windowId = url.searchParams.get("sourceWindowId");
  if (!tabId || !windowId || !/^\d+$/.test(tabId) || !/^\d+$/.test(windowId)) throw new Error("Invalid confirmation context");
  const sourceTabId = Number(tabId);
  const sourceWindowId = Number(windowId);
  if (!Number.isSafeInteger(sourceTabId) || !Number.isSafeInteger(sourceWindowId)) throw new Error("Invalid confirmation context");
  return { sourceTabId, sourceWindowId };
}

export function temporaryConfirmationContext(sender: Runtime.MessageSender): ConfirmationContext {
  const url = confirmationPage(sender);
  const menuUid = url.searchParams.get("menuUid");
  const uid = url.searchParams.get("uid");
  if (url.searchParams.has("kind") || !menuUid || !uid) throw new Error("Invalid confirmation context");
  return { ...confirmationSource(url), menuUid, uid };
}

export function staticConfirmationContext(sender: Runtime.MessageSender): ConfirmationSource {
  const url = confirmationPage(sender);
  if (url.searchParams.get("kind") !== "static") throw new Error("Invalid static bookmark confirmation");
  return confirmationSource(url);
}
