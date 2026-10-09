import { normalizeMenuSpacing, type LayoutEntry, type MenuSpacing } from "@browserail/protocol";
import type { StoredMenuItem } from "../config";
import { combineRootAndItemPath, findBookmarkNodeByPath, type BookmarkNode } from "./index";
import { menuEntryIdentity } from "./identity";

function storedGapKey(uid: string, items: StoredMenuItem[], tree: BookmarkNode[], rootPrefix: string[]): string {
  if (items.some(item => item.uid === uid)) return uid;
  const { itemUid, bookmarkId } = menuEntryIdentity(uid);
  if (bookmarkId === undefined) return itemUid;
  const item = items.find(item => item.uid === itemUid);
  if (item?.type === "staticTag" || item?.type === "flattenStaticTag") return `${itemUid}/static:${encodeURIComponent(bookmarkId)}`;
  if (item?.type !== "flattenFolder") throw new Error("Invalid flattened bookmark spacing");
  const folder = findBookmarkNodeByPath(tree, combineRootAndItemPath(rootPrefix, item.path), item.url);
  const children = folder?.children ?? [];
  const index = children.findIndex(child => child.id === bookmarkId);
  const child = children[index];
  if (!child) throw new Error("The bookmark no longer exists");
  const occurrence = children.slice(0, index).filter(node => node.title === child.title).length;
  return `${itemUid}/path:${encodeURIComponent(JSON.stringify([child.title]))}/${occurrence}`;
}

export function projectMenuSpacing(spacing: MenuSpacing, items: StoredMenuItem[], entries: LayoutEntry[], tree: BookmarkNode[], rootPrefix: string[]): MenuSpacing {
  const extraGaps = Object.fromEntries(entries.flatMap(entry => {
    const key = storedGapKey(entry.uid, items, tree, rootPrefix);
    return Object.hasOwn(spacing.extraGaps, key) ? [[entry.uid, spacing.extraGaps[key]!]] : [];
  }));
  return { gapRatio: spacing.gapRatio, extraGaps };
}

export function storeMenuSpacing(spacing: MenuSpacing, items: StoredMenuItem[], tree: BookmarkNode[], rootPrefix: string[]): MenuSpacing {
  return normalizeMenuSpacing({ gapRatio: spacing.gapRatio, extraGaps: Object.fromEntries(
    Object.entries(spacing.extraGaps).map(([uid, value]) => [storedGapKey(uid, items, tree, rootPrefix), value]),
  ) });
}
