import type { LayoutEntry } from "@browserail/protocol";
import browser from "webextension-polyfill";

import type { StoredMenuItem, TabMode } from "./config";

export interface BookmarkNode {
  children?: BookmarkNode[];
  id: string;
  title: string;
  url?: string;
}

export function normalizeCategory(name: string): string {
  const lower = name.trim().toLowerCase();
  if (
    lower === "bookmarks bar" ||
    lower === "bookmarks toolbar" ||
    lower === "书签栏" ||
    lower === "书签工具栏" ||
    lower === "favourites bar" ||
    lower === "favorites bar"
  ) {
    return "toolbar";
  }
  if (
    lower === "other bookmarks" ||
    lower === "其他书签" ||
    lower === "unfiled bookmarks" ||
    lower === "未分类书签"
  ) {
    return "other";
  }
  if (lower === "mobile bookmarks" || lower === "移动设备书签") {
    return "mobile";
  }
  if (lower === "bookmarks menu" || lower === "书签菜单") {
    return "menu";
  }
  return lower;
}

export function findBookmarkNodeByPath(
  nodes: BookmarkNode[],
  path: string[],
  targetUrl?: string,
): BookmarkNode | undefined {
  if (!path || path.length === 0) {
    if (targetUrl) {
      return findBookmarkByUrl(nodes, targetUrl);
    }
    return undefined;
  }

  function search(currentList: BookmarkNode[], pathIndex: number): BookmarkNode | undefined {
    if (pathIndex >= path.length) return undefined;
    const targetSegment = path[pathIndex];
    const isRootLevel = pathIndex === 0;
    const targetNormalized = isRootLevel
      ? normalizeCategory(targetSegment)
      : targetSegment.trim().toLowerCase();

    for (const node of currentList) {
      const nodeTitle = (node.title || "").trim().toLowerCase();
      const nodeNormalized = isRootLevel ? normalizeCategory(node.title || "") : nodeTitle;
      const matches = nodeNormalized === targetNormalized;

      if (matches) {
        if (pathIndex === path.length - 1) {
          return node;
        }
        if (node.children) {
          const found = search(node.children, pathIndex + 1);
          if (found) return found;
        }
      }
    }

    if (isRootLevel) {
      for (const node of currentList) {
        if (node.children) {
          const found = search(node.children, pathIndex);
          if (found) return found;
        }
      }
    }

    return undefined;
  }

  const found = search(nodes, 0);
  if (found) return found;

  if (targetUrl) {
    const urlMatch = findBookmarkByUrl(nodes, targetUrl);
    if (urlMatch) return urlMatch;
  }

  const leafTitle = path[path.length - 1].trim().toLowerCase();
  function searchByLeafTitle(list: BookmarkNode[]): BookmarkNode | undefined {
    for (const node of list) {
      if ((node.title || "").trim().toLowerCase() === leafTitle) {
        return node;
      }
      if (node.children) {
        const res = searchByLeafTitle(node.children);
        if (res) return res;
      }
    }
    return undefined;
  }
  return searchByLeafTitle(nodes);
}

function findBookmarkByUrl(nodes: BookmarkNode[], url: string): BookmarkNode | undefined {
  for (const node of nodes) {
    if (node.url === url) {
      return node;
    }
    if (node.children) {
      const found = findBookmarkByUrl(node.children, url);
      if (found) return found;
    }
  }
  return undefined;
}

export async function resolveMenuItems(
  items: StoredMenuItem[],
  menuTabMode?: TabMode,
  menuColor?: string,
): Promise<LayoutEntry[]> {
  let treeCache: BookmarkNode[] | null = null;
  const entryGroups = await Promise.all(
    items.map(async ({ bookmarkId, path, url, color, emoji, rename, type, expandOnHover, tabMode }) => {
      let node: BookmarkNode | undefined;
      if (bookmarkId) {
        try {
          const nodes = (await browser.bookmarks.getSubTree(bookmarkId)) as BookmarkNode[];
          node = nodes[0];
        } catch {
          // not found by ID
        }
      }

      if (!node && ((path && path.length > 0) || url)) {
        if (!treeCache) {
          try {
            treeCache = (await browser.bookmarks.getTree()) as BookmarkNode[];
          } catch {
            treeCache = [];
          }
        }
        node = findBookmarkNodeByPath(treeCache, path ?? [], url);
      }

      if (!node) {
        return [];
      }

      const effectiveTabMode: TabMode = tabMode || menuTabMode || "replace";
      const effectiveColor = color || menuColor;

      if (type === "flattenFolder" || (!node.url && type === "flattenFolder")) {
        const bookmarkChildren = (node.children ?? []).filter((child) => child.url !== undefined);
        return bookmarkChildren.map((child) => {
          const rawTitle = child.title || child.url || "Untitled";
          const detectedEmoji = extractLeadingEmoji(rawTitle);
          const entry: LayoutEntry = {
            kind: "bookmark",
            uid: actionUid("bookmark", child.id, effectiveTabMode),
            label: rawTitle,
            ...(detectedEmoji ? { emoji: detectedEmoji } : {}),
            ...(effectiveColor ? { color: effectiveColor } : {}),
          };
          return entry;
        });
      }

      const effectiveHover = expandOnHover !== undefined ? expandOnHover : true;
      const entry = toLayoutEntry(node, effectiveHover, effectiveTabMode, effectiveColor);
      if (effectiveColor) {
        entry.color = effectiveColor;
      }
      const effectiveRename = rename || emoji;
      if (effectiveRename) {
        entry.rename = effectiveRename;
        entry.emoji = effectiveRename;
      }
      return [entry];
    }),
  );

  return entryGroups.flat();
}

function toLayoutEntry(
  node: BookmarkNode,
  expandOnHover?: boolean,
  tabMode?: TabMode,
  defaultColor?: string,
): LayoutEntry {
  const title = node.title || (node.url !== undefined ? node.url : "Bookmarks");
  const detectedEmoji = extractLeadingEmoji(title);

  if (node.url !== undefined) {
    return {
      kind: "bookmark",
      uid: actionUid("bookmark", node.id, tabMode),
      label: node.title || node.url,
      ...(detectedEmoji ? { emoji: detectedEmoji } : {}),
      ...(defaultColor ? { color: defaultColor } : {}),
    };
  }

  return {
    kind: "folder",
    uid: actionUid("folder", node.id),
    label: node.title || "Bookmarks",
    children: (node.children ?? []).map((child) => toLayoutEntry(child, expandOnHover, tabMode, defaultColor)),
    ...(detectedEmoji ? { emoji: detectedEmoji } : {}),
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
  };
}

export function actionUid(
  kind: "bookmark" | "folder",
  bookmarkId: string,
  tabMode?: TabMode,
): string {
  const base = `${kind}:${encodeURIComponent(bookmarkId)}`;
  if (kind === "bookmark" && tabMode === "newTab") {
    return `${base}?tab=newTab`;
  }
  return base;
}

export function extractLeadingEmoji(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u);
  return match ? match[1] : null;
}
