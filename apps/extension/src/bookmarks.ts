import type { LayoutEntry } from "@browserail/protocol";
import browser from "webextension-polyfill";

import type { StoredMenuItem } from "./config";

interface BookmarkNode {
  children?: BookmarkNode[];
  id: string;
  title: string;
  url?: string;
}

export async function resolveMenuItems(items: StoredMenuItem[]): Promise<LayoutEntry[]> {
  const entries = await Promise.all(
    items.map(async ({ bookmarkId }) => {
      const nodes = (await browser.bookmarks.getSubTree(bookmarkId)) as BookmarkNode[];
      const node = nodes[0];
      if (!node) {
        return undefined;
      }

      return toLayoutEntry(node);
    }),
  );

  return entries.filter((entry): entry is LayoutEntry => entry !== undefined);
}

function toLayoutEntry(node: BookmarkNode): LayoutEntry {
  if (node.url !== undefined) {
    return { kind: "bookmark", uid: actionUid("bookmark", node.id), label: node.title || node.url };
  }

  return {
    kind: "folder",
    uid: actionUid("folder", node.id),
    label: node.title || "Bookmarks",
    children: (node.children ?? []).map(toLayoutEntry),
  };
}

export function actionUid(kind: "bookmark" | "folder", bookmarkId: string): string {
  return `${kind}:${encodeURIComponent(bookmarkId)}`;
}
