import { t } from "@browserail/i18n";
import {
  actionUid,
  type ExpandDirection,
  type LayoutEntry,
  SPECIAL_ROOT_PLACEHOLDERS,
  type SpecialRootType,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

import type { StoredMenuItem, TabMode } from "./config";

export { actionUid, SPECIAL_ROOT_PLACEHOLDERS, type SpecialRootType };

export interface BookmarkNode {
  children?: BookmarkNode[];
  id: string;
  title: string;
  url?: string;
}

export function getSpecialRootTypeFromTitle(name: string): SpecialRootType | undefined {
  const lower = name.trim().toLowerCase();
  if (
    lower === "${bookmarks-bar}" ||
    lower === "${bookmarks_bar}" ||
    lower === "${toolbar}" ||
    lower === "bookmarks-bar" ||
    lower === "toolbar" ||
    lower === "bookmarks bar" ||
    lower === "bookmarks toolbar" ||
    lower === "书签栏" ||
    lower === "书签工具栏" ||
    lower === "書籤列" ||
    lower === "favourites bar" ||
    lower === "favorites bar" ||
    lower === "ブックマーク バー"
  ) {
    return "bookmarks-bar";
  }
  if (
    lower === "${other}" ||
    lower === "${unfiled}" ||
    lower === "other" ||
    lower === "unfiled" ||
    lower === "other bookmarks" ||
    lower === "其他书签" ||
    lower === "其他書籤" ||
    lower === "unfiled bookmarks" ||
    lower === "未分类书签" ||
    lower === "その他のブックマーク"
  ) {
    return "other";
  }
  if (
    lower === "${mobile}" ||
    lower === "mobile" ||
    lower === "mobile bookmarks" ||
    lower === "移动设备书签" ||
    lower === "行動裝置書籤" ||
    lower === "モバイルのブックマーク"
  ) {
    return "mobile";
  }
  if (
    lower === "${managed}" ||
    lower === "managed" ||
    lower === "managed bookmarks" ||
    lower === "受管理书签" ||
    lower === "企业书签" ||
    lower.includes("managed") ||
    lower.includes("受管理")
  ) {
    return "managed";
  }
  return undefined;
}

export function getSpecialRootTypeFromNode(
  node: { id?: string; title?: string },
  isTopLevel = true,
): SpecialRootType | undefined {
  if (!isTopLevel) return undefined;
  if (node.id === "1" || node.id === "toolbar_____") return "bookmarks-bar";
  if (node.id === "2" || node.id === "unfiled_____") return "other";
  if (node.id === "3" || node.id === "mobile______") return "mobile";
  if (node.id === "managed") return "managed";
  return getSpecialRootTypeFromTitle(node.title || "");
}

export function getSpecialRootPlaceholder(node: { id?: string; title?: string }): string | undefined {
  const type = getSpecialRootTypeFromNode(node);
  return type ? SPECIAL_ROOT_PLACEHOLDERS[type] : undefined;
}

export function formatSpecialRootForDisplay(
  segment: string,
  tree?: BookmarkNode[] | browser.Bookmarks.BookmarkTreeNode[],
): string {
  const special = getSpecialRootTypeFromTitle(segment);
  if (!special) return segment;

  if (tree && tree.length > 0) {
    const first = tree[0];
    const rootNodes =
      tree.length === 1 && first && (first.id === "0" || !first.title) && first.children
        ? first.children
        : tree;
    for (const node of rootNodes) {
      if (getSpecialRootTypeFromNode(node) === special && node.title && node.title.trim()) {
        return node.title.trim();
      }
    }
  }

  switch (special) {
    case "bookmarks-bar":
      return t("common.bookmarksBar") || "Bookmarks bar";
    case "other":
      return t("common.otherBookmarks") || "Other bookmarks";
    case "mobile":
      return t("common.mobileBookmarks") || "Mobile bookmarks";
    case "managed":
      return t("common.managedBookmarks") || "Managed bookmarks";
  }
}

export function normalizeCategory(name: string): string {
  const special = getSpecialRootTypeFromTitle(name);
  if (special) return special;
  const lower = name.trim().toLowerCase();
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
  const first = nodes[0];
  const actualNodes =
    nodes.length === 1 && first && (first.id === "0" || !first.title) && first.children
      ? first.children
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
    if (!targetSegment) return undefined;
    const isRootLevel = pathIndex === 0;
    const targetSpecial = isRootLevel ? getSpecialRootTypeFromTitle(targetSegment) : undefined;
    const targetNormalized = isRootLevel
      ? normalizeCategory(targetSegment)
      : targetSegment.trim().toLowerCase();

    for (const node of currentList) {
      const nodeTitle = (node.title || "").trim().toLowerCase();
      const nodeSpecial = isRootLevel ? getSpecialRootTypeFromNode(node) : undefined;

      let matches = false;
      if (isRootLevel && (targetSpecial || nodeSpecial)) {
        matches = targetSpecial !== undefined && nodeSpecial === targetSpecial;
      } else {
        const nodeNormalized = isRootLevel ? normalizeCategory(node.title || "") : nodeTitle;
        matches = nodeNormalized === targetNormalized;
      }

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

export function combineRootAndItemPath(rootPath?: string[], itemPath?: string[]): string[] {
  // Both are arrays of individual folder titles (a title may itself contain
  // "/"), so their elements must NOT be re-split on "/".
  const rootSegments = rootPath ? rootPath.map((s) => s.trim()).filter(Boolean) : [];
  const segments = itemPath ? itemPath.map((s) => s.trim()).filter(Boolean) : [];

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
  rootPrefix?: string[],
): string[] | undefined {
  const fullNodePath = getFolderPath(targetId, nodes);
  const meaningfulNodes = fullNodePath.filter(
    (n) => n.id !== "0" && Boolean(n.title && n.title.trim()),
  );

  if (meaningfulNodes.length === 0) {
    if (targetId === "0") return [];
    return undefined;
  }

  const fullSegments = meaningfulNodes.map((n, idx) => {
    if (idx === 0) {
      const special = getSpecialRootTypeFromNode(n);
      if (special) {
        return SPECIAL_ROOT_PLACEHOLDERS[special];
      }
    }
    return n.title.trim();
  });

  if (rootPrefix && rootPrefix.length > 0) {
    const rootSegments = rootPrefix.map((s) => s.trim()).filter(Boolean);
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
            .filter((n) => n.id !== "0" && Boolean(n.title && n.title.trim()))
            .map((n) => n.title.trim());
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


const FLATTEN_SPACE_PREFIX = "BrowseRailSpace:";
const FLATTEN_SPACE_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:\/\/)?browserail\.local\/?#Space:(.*)$/i;

function parseFlattenSpaceDirective(child: BookmarkNode): SpaceEntry | null {
  if (child.url === undefined) return null;

  const titleDirective = child.title.startsWith(FLATTEN_SPACE_PREFIX)
    ? child.title.slice(FLATTEN_SPACE_PREFIX.length)
    : undefined;
  const urlMatch = FLATTEN_SPACE_URL_PATTERN.exec(child.url);
  const urlDirective = urlMatch ? decodeURIComponent(urlMatch[1]) : undefined;
  const directive = titleDirective ?? urlDirective;
  if (directive === undefined) return null;

  const fields = new Map<string, string>();
  for (const part of directive.split(":")) {
    const [key, ...rawValue] = part.split("=");
    if (!key) continue;
    fields.set(key.toLowerCase(), rawValue.join("="));
  }

  const unitsValue = fields.get("units");
  const transparentValue = fields.get("transparent");
  const color = fields.get("color");

  const units = unitsValue === undefined || !Number.isFinite(Number(unitsValue))
    ? 1
    : Math.max(0.1, Math.min(20, Number(unitsValue)));
  const transparent = transparentValue === undefined || transparentValue.toLowerCase() !== "false";
  const isColor = color !== undefined && /^#[0-9a-f]{6}$/i.test(color);

  return {
    kind: "space",
    uid: `space:bookmark-${child.id}`,
    units,
    ...(isColor && !transparent ? { color } : {}),
    transparent,
  };
}

export async function resolveMenuItems(
  items: StoredMenuItem[],
  menuTabMode?: TabMode,
  menuColor?: string,
  menuExpandDirection?: ExpandDirection,
  rootPrefix?: string[],
): Promise<LayoutEntry[]> {
  let treeCache: BookmarkNode[] | null = null;
  const entryGroups = await Promise.all(
    items.map(async ({ bookmarkId, path, url, color, cycleColors, emoji, rename, type, expandOnHover, includeFolders, tabMode, units, transparent }) => {
      if (type === "menuToggle") {
        const entry: LayoutEntry = {
          kind: "menuToggle",
          uid: `menu-toggle:${bookmarkId}`,
          label: "Menu",
        };
        return [entry];
      }

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
        const lastSeg = path && path.length > 0 ? path[path.length - 1] : undefined;
        const fallbackTitle =
          (lastSeg ? formatSpecialRootForDisplay(lastSeg, treeCache ?? []) : undefined) ||
          (rootPrefix && rootPrefix.length > 0 ? rootPrefix[rootPrefix.length - 1] : undefined) ||
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

      if (type === "flattenFolder") {
        const colors = Array.isArray(cycleColors) && cycleColors.length > 0 ? cycleColors : [];
        let flattenedIdx = 0;
        return (node.children ?? []).flatMap((child) => {
          const directive = parseFlattenSpaceDirective(child);
          if (directive) return [directive];
          if (child.url === undefined) {
            // Sub-folder: only emitted when "include folders" is on, as a folder
            // that inherits this flatten item's folder options.
            if (!includeFolders) return [];
            const itemColor = colors.length > 0 ? colors[flattenedIdx % colors.length] : menuColor;
            flattenedIdx++;
            const folderEntry = toLayoutEntry(
              child,
              effectiveHover,
              effectiveTabMode,
              undefined,
              menuExpandDirection,
            );
            // Apply the flatten item's cycle color to the outside folder button itself,
            // matching the flattened bookmarks on the rail.
            if (itemColor && folderEntry.kind !== "space") {
              folderEntry.color = itemColor;
            }
            return [folderEntry];
          }
          const itemColor = colors.length > 0 ? colors[flattenedIdx % colors.length] : menuColor;
          flattenedIdx++;
          const rawTitle = child.title || child.url || "Untitled";
          const entry: LayoutEntry = {
            kind: "bookmark",
            uid: actionUid("bookmark", child.id, effectiveTabMode),
            label: rawTitle,
            ...(itemColor ? { color: itemColor } : {}),
          };
          return [entry];
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
