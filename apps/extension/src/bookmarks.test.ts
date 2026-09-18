import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    bookmarks: {
      getSubTree: vi.fn(),
    },
  },
}));

import browser from "webextension-polyfill";
import type { FolderEntry } from "@browserail/protocol";
import { findBookmarkNodeByPath, resolveMenuItems } from "./bookmarks";

describe("resolveMenuItems", () => {
  it("resolves a folder with expandOnHover set to false", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "folder-1",
        title: "Dev Tools",
        children: [
          { id: "bm-1", title: "GitHub", url: "https://github.com" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "folder-1", type: "folder", expandOnHover: false },
    ]);

    expect(entries).toHaveLength(1);
    const folder = entries[0] as FolderEntry;
    expect(folder.kind).toBe("folder");
    expect(folder.expandOnHover).toBe(false);
    expect(folder.children).toHaveLength(1);
  });

  it("resolves a folder with default hover expansion", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "folder-2",
        title: "Docs",
        children: [
          { id: "bm-2", title: "MDN", url: "https://developer.mozilla.org" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "folder-2", type: "folder" },
    ]);

    expect(entries).toHaveLength(1);
    const folder = entries[0] as FolderEntry;
    expect(folder.kind).toBe("folder");
    expect(folder.expandOnHover).toBe(true);
  });

  it("flattens a folder into individual bookmark entries when type is flattenFolder", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "folder-3",
        title: "Quick Links",
        children: [
          { id: "bm-3", title: "GitHub", url: "https://github.com" },
          { id: "bm-4", title: "Vite", url: "https://vitejs.dev" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "folder-3", type: "flattenFolder" },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("bookmark");
    expect(entries[1].kind).toBe("bookmark");
  });
});

describe("findBookmarkNodeByPath", () => {
  const tree = [
    {
      id: "root-1",
      title: "Bookmarks Toolbar",
      children: [
        {
          id: "folder-dev",
          title: "Dev",
          children: [
            { id: "bm-gh", title: "GitHub", url: "https://github.com" },
            { id: "bm-vt", title: "Vite", url: "https://vitejs.dev" },
          ],
        },
        {
          id: "bm-ddg",
          title: "DuckDuckGo",
          url: "https://duckduckgo.com",
        },
      ],
    },
    {
      id: "root-2",
      title: "Other Bookmarks",
      children: [
        { id: "bm-rd", title: "Reddit", url: "https://reddit.com" },
      ],
    },
  ];

  it("finds bookmark by cross-browser root alias (Chrome '书签栏' -> Firefox 'Bookmarks Toolbar')", () => {
    const found = findBookmarkNodeByPath(tree, ["书签栏", "Dev", "GitHub"], "https://github.com");
    expect(found).toBeDefined();
    expect(found?.id).toBe("bm-gh");
  });

  it("finds bookmark by English Chrome alias 'Bookmarks bar' to 'Bookmarks Toolbar'", () => {
    const found = findBookmarkNodeByPath(tree, ["Bookmarks bar", "DuckDuckGo"], "https://duckduckgo.com");
    expect(found).toBeDefined();
    expect(found?.id).toBe("bm-ddg");
  });

  it("finds folder node by path", () => {
    const found = findBookmarkNodeByPath(tree, ["Bookmarks Toolbar", "Dev"]);
    expect(found).toBeDefined();
    expect(found?.id).toBe("folder-dev");
  });

  it("falls back to URL search when path has diverged", () => {
    const found = findBookmarkNodeByPath(tree, ["Nonexistent Folder", "GitHub"], "https://github.com");
    expect(found).toBeDefined();
    expect(found?.id).toBe("bm-gh");
  });
});
