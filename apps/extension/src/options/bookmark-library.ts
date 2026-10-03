import browser from "webextension-polyfill";
import { isCustomBookmarkType } from "@browserail/protocol";
import type { StoredMenuItem } from "../config";
import type { ReadonlyData } from "./state";
import {
  combineRootAndItemPath,
  findBookmarkNodeByPath,
  formatSpecialRootForDisplay,
  getItemRelativePath,
  getSpecialRootTypeFromTitle,
  resolveBookmarkNodeByPath,
  SPECIAL_ROOT_PLACEHOLDERS,
  type BookmarkNode,
} from "../bookmarks";
export function createBookmarkLibrary(getRootPrefix: () => readonly string[]) {
  let tree: browser.Bookmarks.BookmarkTreeNode[] = [];
  function getRootNode(): browser.Bookmarks.BookmarkTreeNode | undefined {
    const segments = getRootPrefix()
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length === 0) return undefined;
    return findBookmarkNodeByPath(tree as BookmarkNode[], segments) as
      browser.Bookmarks.BookmarkTreeNode | undefined;
  }

  function formatRootPrefixDisplay(segments: string[]): string {
    if (segments.length === 0) return "/";
    const shown = segments.map((seg, idx) =>
      idx === 0 ? formatSpecialRootForDisplay(seg, tree) : seg,
    );
    return "/" + shown.join("/");
  }

  function findBookmarkNode(
    id: string,
    nodes: browser.Bookmarks.BookmarkTreeNode[],
  ): browser.Bookmarks.BookmarkTreeNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findBookmarkNode(id, node.children);
        if (found) return found;
      }
    }
    return undefined;
  }

  function getItemNode(
    item: ReadonlyData<StoredMenuItem>,
  ): browser.Bookmarks.BookmarkTreeNode | undefined {
    return getItemResolution(item).node as browser.Bookmarks.BookmarkTreeNode | undefined;
  }

  function getItemResolution(item: ReadonlyData<StoredMenuItem>) {
    const effectivePath = combineRootAndItemPath(
      [...getRootPrefix()],
      item.path ? [...item.path] : undefined,
    );
    if (effectivePath.length > 0 || item.url) {
      return resolveBookmarkNodeByPath(tree as BookmarkNode[], effectivePath, item.url);
    }
    return { duplicatePath: false };
  }

  function enrichMenuItems(
    items: StoredMenuItem[],
    nodes: browser.Bookmarks.BookmarkTreeNode[],
  ): void {
    if (nodes.length === 0) return;
    for (const item of items) {
      if (item.path && item.path.length > 0) {
        const firstSeg = item.path[0];
        if (firstSeg) {
          const special = getSpecialRootTypeFromTitle(firstSeg);
          if (special) {
            item.path[0] = SPECIAL_ROOT_PLACEHOLDERS[special];
          }
        }
      }
      if (
        item.type === "space" ||
        item.type === "menuFold" ||
        item.type === "menusToggle" ||
        item.type === "browserAction" ||
        isCustomBookmarkType(item.type)
      )
        continue;
      const node = getItemNode(item);
      if (!node) continue;
      const refreshedPath = getItemRelativePath(node.id, nodes as BookmarkNode[], [
        ...getRootPrefix(),
      ]);
      if (refreshedPath !== undefined) {
        item.path = refreshedPath;
      }
      if (!item.type) {
        item.type = node.children !== undefined || node.url === undefined ? "folder" : "bookmark";
      }
      if (node.url !== undefined) {
        item.url = node.url;
      } else {
        delete item.url;
      }
    }
  }

  async function refreshBookmarkTree(): Promise<void> {
    try {
      tree = await browser.bookmarks.getTree();
    } catch {
      // Keep the previous cache if the read fails.
    }
  }

  return {
    get tree() {
      return tree;
    },
    initialize(value: browser.Bookmarks.BookmarkTreeNode[]): void {
      tree = value;
    },
    refresh: refreshBookmarkTree,
    async createBookmark(details: browser.Bookmarks.CreateDetails): Promise<void> {
      await browser.bookmarks.create(details);
      tree = await browser.bookmarks.getTree();
    },
    root: getRootNode,
    formatRoot: formatRootPrefixDisplay,
    find(id: string) {
      return findBookmarkNode(id, tree);
    },
    item: getItemNode,
    resolve: getItemResolution,
    enrich: enrichMenuItems,
  };
}
export type BookmarkLibrary = ReturnType<typeof createBookmarkLibrary>;
