import type { BookmarkNode } from "../bookmarks";
import { isTemporaryUidInTree } from "../bookmarks";
import type { StoredMenu } from "../config";
import { saveTemporaryValue } from "../config";

export async function captureTemporaryUrl(
  tabs: { query(query: { active: true; windowId: number }): Promise<Array<{ url?: string }>> },
  menus: StoredMenu[],
  uid: string,
  windowUid: string,
  confirmed: boolean,
  note = "",
  bookmarkTree?: BookmarkNode[],
): Promise<"saved" | "needsConfirmation" | "unavailable"> {
  const inMenus = menus.some((menu) => menu.items.some((item) => item.type === "temporary" && item.uid === uid));
  const inBookmarks = bookmarkTree ? isTemporaryUidInTree(bookmarkTree, uid) : false;
  if (!inMenus && !inBookmarks) {
    return "unavailable";
  }
  if (!confirmed) return "needsConfirmation";
  const [tab] = await tabs.query({ active: true, windowId: Number(windowUid) });
  if (!tab?.url) return "unavailable";
  await saveTemporaryValue(uid, tab.url, note);
  return "saved";
}
