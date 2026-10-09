import browser from "webextension-polyfill";

let capability: Promise<boolean> | undefined;
// Some browsers (e.g. Firefox for Android) install the extension but expose no
// bookmarks API, or one that rejects every call.
export function canUseBookmarks(): Promise<boolean> {
  return capability ??= detectBookmarks();
}
async function detectBookmarks(): Promise<boolean> {
  if (typeof browser.bookmarks?.getTree !== "function") return false;
  try {
    await browser.bookmarks.getTree();
    return true;
  } catch {
    return false;
  }
}
