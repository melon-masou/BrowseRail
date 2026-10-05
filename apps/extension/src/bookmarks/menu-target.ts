import browser from "webextension-polyfill";
import type { CustomBookmarkType } from "@browserail/protocol";
import { loadBookmarkRootPrefix, type ExtensionConfig } from "../config";
import { combineRootAndItemPath, findBookmarkNodeByPath, parseDynamicMarkerUrl, parseFlattenTemporaryDirective, type BookmarkNode } from "./index";
import { parseMenuItemIdentity } from "./identity";

export async function resolveMenuBookmarkTarget(config: ExtensionConfig, menuUid: string, identity: string, type: "bookmark" | CustomBookmarkType): Promise<string> {
  const { itemUid, bookmarkId } = parseMenuItemIdentity(identity);
  const item = config.panel.menus.find(menu => menu.uid === menuUid)?.items.find(item => item.uid === itemUid);
  if (!item) throw new Error("The menu item no longer exists");
  if (type === "bookmark") {
    if (item.type && !["bookmark", "folder", "flattenFolder"].includes(item.type)) throw new Error("Invalid bookmark action");
    if (bookmarkId !== undefined) {
      return bookmarkId;
    }
    const [tree, rootPrefix] = await Promise.all([browser.bookmarks.getTree(), loadBookmarkRootPrefix()]);
    const node = findBookmarkNodeByPath(tree as BookmarkNode[], combineRootAndItemPath(rootPrefix, item.path), item.url);
    if (!node?.url) throw new Error("The bookmark no longer exists");
    return node.id;
  }
  if (bookmarkId !== undefined) {
    if (item.type !== "flattenFolder") throw new Error("Invalid bookmark action");
    const [node] = await browser.bookmarks.get(bookmarkId);
    const target = node && (type === "temporary" ? parseFlattenTemporaryDirective(node)?.uid
      : type === "dynamic" ? parseDynamicMarkerUrl(node.url) : undefined);
    if (!target) throw new Error("The bookmark no longer exists");
    return target;
  }
  if (item.type !== type) throw new Error("Invalid bookmark action");
  const target = type === "temporary" ? item.temporaryUid : type === "dynamic" ? item.dynamicUid : item.staticUid;
  if (!target) throw new Error("The bookmark no longer exists");
  return target;
}
