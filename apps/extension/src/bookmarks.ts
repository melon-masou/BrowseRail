import type { ExpandDirection, LayoutEntry } from "@browserail/protocol";
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
  const actualNodes =
    nodes.length === 1 && (nodes[0].id === "0" || !nodes[0].title) && nodes[0].children
      ? nodes[0].children
      : nodes;

  if (!path || path.length === 0) {
    if (targetUrl) {
      return findBookmarkByUrl(actualNodes, targetUrl);
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

    return undefined;
  }

  const found = search(actualNodes, 0);
  if (found) return found;

  if (targetUrl) {
    const urlMatch = findBookmarkByUrl(actualNodes, targetUrl);
    if (urlMatch) return urlMatch;
  }

  return undefined;
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

export function parsePathSegments(rawPath: string): string[] {
  return rawPath
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function combineRootAndItemPath(rootPath?: string, itemPath?: string[]): string[] {
  const rootSegments = rootPath ? parsePathSegments(rootPath) : [];
  const segments = itemPath ? itemPath.flatMap(parsePathSegments) : [];

  if (rootSegments.length === 0) {
    return segments;
  }
  return [...rootSegments, ...segments];
}

export function getFolderPath(
  id: string,
  nodes: BookmarkNode[],
): BookmarkNode[] {
  function search(
    current: BookmarkNode,
    targetId: string,
    path: BookmarkNode[],
  ): BookmarkNode[] | null {
    const newPath = [...path, current];
    if (current.id === targetId) return newPath;
    if (current.children) {
      for (const child of current.children) {
        const res = search(child, targetId, newPath);
        if (res) return res;
      }
    }
    return null;
  }

  for (const root of nodes) {
    const res = search(root, id, []);
    if (res) return res;
  }
  return [];
}

export function getItemRelativePath(
  targetId: string,
  nodes: BookmarkNode[],
  rootPrefix?: string,
): string[] | undefined {
  const fullNodePath = getFolderPath(targetId, nodes);
  const fullSegments = fullNodePath
    .map((n) => n.title)
    .filter((t) => Boolean(t && t.trim()));

  if (fullSegments.length === 0) return undefined;

  if (rootPrefix && rootPrefix.trim()) {
    const rootSegments = parsePathSegments(rootPrefix);
    if (rootSegments.length > 0) {
      const rootNode = findBookmarkNodeByPath(nodes, rootSegments);
      if (rootNode) {
        const rootNodePath = getFolderPath(rootNode.id, nodes);
        if (
          fullNodePath.length >= rootNodePath.length &&
          fullNodePath.slice(0, rootNodePath.length).every((n, i) => n.id === rootNodePath[i]?.id)
        ) {
          const relNodes = fullNodePath.slice(rootNodePath.length);
          const relSegments = relNodes
            .map((n) => n.title)
            .filter((t) => Boolean(t && t.trim()));
          return relSegments;
        }
      }

      if (fullSegments.length >= rootSegments.length) {
        const matches = rootSegments.every((seg, idx) => {
          const fullSeg = fullSegments[idx];
          if (!fullSeg) return false;
          return (
            fullSeg.toLowerCase() === seg.toLowerCase() ||
            normalizeCategory(fullSeg) === normalizeCategory(seg)
          );
        });
        if (matches) {
          const relSegments = fullSegments.slice(rootSegments.length);
          return relSegments;
        }
      }
    }
  }

  return fullSegments;
}


export async function resolveMenuItems(
  items: StoredMenuItem[],
  menuTabMode?: TabMode,
  menuColor?: string,
  menuExpandDirection?: ExpandDirection,
  rootPrefix?: string,
): Promise<LayoutEntry[]> {
  let treeCache: BookmarkNode[] | null = null;
  const entryGroups = await Promise.all(
    items.map(async ({ bookmarkId, path, url, color, emoji, rename, type, expandOnHover, tabMode, units, transparent }) => {
      if (type === "space") {
        const isTransparent = transparent !== false;
        const spaceEntry: LayoutEntry = {
          kind: "space",
          uid: bookmarkId || `space-${Math.random().toString(36).slice(2, 9)}`,
          units: units !== undefined ? units : 1,
          ...(!isTransparent && (color || menuColor) ? { color: (color || menuColor) as string } : {}),
          transparent: isTransparent,
        };
        return [spaceEntry];
      }

      const effectivePath = combineRootAndItemPath(rootPrefix, path);

      let node: BookmarkNode | undefined;
      if (effectivePath.length > 0 || url) {
        if (!treeCache) {
          try {
            treeCache = (await browser.bookmarks.getTree()) as BookmarkNode[];
          } catch {
            treeCache = [];
          }
        }
        node = findBookmarkNodeByPath(treeCache, effectivePath, url);
      }

      const effectiveTabMode: TabMode = tabMode || menuTabMode || "replace";
      const effectiveColor = color || menuColor;
      const effectiveHover = expandOnHover !== undefined ? expandOnHover : true;
      const effectiveRename = rename || emoji;

      if (!node) {
        const fallbackTitle =
          (path && path.length > 0 ? path[path.length - 1] : undefined) ||
          (rootPrefix ? parsePathSegments(rootPrefix).slice(-1)[0] : undefined) ||
          url ||
          bookmarkId ||
          "Untitled";

        const isFolder = type === "folder";
        const entry: LayoutEntry = isFolder
          ? {
              kind: "folder",
              uid: `noop:folder-${Math.random().toString(36).slice(2, 9)}`,
              label: fallbackTitle,
              children: [],
              ...(effectiveColor ? { color: effectiveColor } : {}),
              expandOnHover: effectiveHover,
              ...(menuExpandDirection ? { expandDirection: menuExpandDirection } : {}),
              ...(effectiveRename ? { rename: effectiveRename } : {}),
            }
          : {
              kind: "bookmark",
              uid: `noop:bookmark-${Math.random().toString(36).slice(2, 9)}`,
              label: fallbackTitle,
              ...(effectiveColor ? { color: effectiveColor } : {}),
              ...(effectiveRename ? { rename: effectiveRename } : {}),
            };
        return [entry];
      }

      if (type === "flattenFolder" || (!node.url && type === "flattenFolder")) {
        const bookmarkChildren = (node.children ?? []).filter((child) => child.url !== undefined);
        return bookmarkChildren.map((child) => {
          const rawTitle = child.title || child.url || "Untitled";
          const entry: LayoutEntry = {
            kind: "bookmark",
            uid: actionUid("bookmark", child.id, effectiveTabMode),
            label: rawTitle,
            ...(effectiveColor ? { color: effectiveColor } : {}),
          };
          return entry;
        });
      }

      const entry = toLayoutEntry(
        node,
        effectiveHover,
        effectiveTabMode,
        effectiveColor,
        menuExpandDirection,
      );
      if (effectiveColor) {
        entry.color = effectiveColor;
      }
      if (effectiveRename && entry.kind !== "space") {
        entry.rename = effectiveRename;
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
  expandDirection?: ExpandDirection,
): LayoutEntry {
  if (node.url !== undefined) {
    return {
      kind: "bookmark",
      uid: actionUid("bookmark", node.id, tabMode),
      label: node.title || node.url,
      ...(defaultColor ? { color: defaultColor } : {}),
    };
  }

  return {
    kind: "folder",
    uid: actionUid("folder", node.id),
    label: node.title || "Bookmarks",
    children: (node.children ?? []).map((child) =>
      toLayoutEntry(child, expandOnHover, tabMode, defaultColor, expandDirection),
    ),
    ...(expandOnHover !== undefined ? { expandOnHover } : {}),
    ...(expandDirection !== undefined ? { expandDirection } : {}),
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
