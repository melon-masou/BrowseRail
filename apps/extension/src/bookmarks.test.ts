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

  it("applies menuColor as default color to items without custom color", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      { id: "bm-color-1", title: "GitHub", url: "https://github.com" },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "bm-color-1" }],
      "replace",
      "#10b981",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].color).toBe("#10b981");
  });

  it("preserves item custom color when menuColor is also provided", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      { id: "bm-color-2", title: "GitHub", url: "https://github.com" },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "bm-color-2", color: "#f59e0b" }],
      "replace",
      "#10b981",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].color).toBe("#f59e0b");
  });

  it("applies menuColor to flattened folder children when no custom color is specified", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "folder-color-flat",
        title: "Links",
        children: [
          { id: "bm-cf-1", title: "Site A", url: "https://a.com" },
          { id: "bm-cf-2", title: "Site B", url: "https://b.com" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "folder-color-flat", type: "flattenFolder" }],
      "replace",
      "#8b5cf6",
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].color).toBe("#8b5cf6");
    expect(entries[1].color).toBe("#8b5cf6");
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

describe("rename and emoji support", () => {
  it("uses custom rename when configured on StoredMenuItem", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-custom-rename",
        title: "Very Long GitHub Bookmark Title",
        url: "https://github.com",
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "bm-custom-rename", rename: "GH" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].rename).toBe("GH");
    expect(entries[0].emoji).toBe("GH");
    expect(entries[0].label).toBe("Very Long GitHub Bookmark Title");
  });

  it("uses custom rename with emoji on StoredMenuItem", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-custom-emoji-rename",
        title: "GitHub",
        url: "https://github.com",
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "bm-custom-emoji-rename", rename: "🐙" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].rename).toBe("🐙");
    expect(entries[0].emoji).toBe("🐙");
    expect(entries[0].label).toBe("GitHub");
  });

  it("uses custom emoji when configured on StoredMenuItem for backwards compatibility", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-custom-emoji",
        title: "GitHub",
        url: "https://github.com",
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "bm-custom-emoji", emoji: "🐙" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].rename).toBe("🐙");
    expect(entries[0].emoji).toBe("🐙");
    expect(entries[0].label).toBe("GitHub");
  });

  it("automatically detects leading emoji from title when no custom emoji is configured", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-title-emoji",
        title: "🚀 Production Server",
        url: "https://prod.example.com",
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "bm-title-emoji" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].emoji).toBe("🚀");
  });
});

describe("tabMode configuration", () => {
  it("defaults to standard actionUid when tabMode is replace or unspecified", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-replace",
        title: "Example",
        url: "https://example.com",
      },
    ] as any);

    const entries = await resolveMenuItems([
      { bookmarkId: "bm-replace" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe("bookmark:bm-replace");
  });

  it("inherits newTab tabMode from menuTabMode", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-menu-tab",
        title: "Example",
        url: "https://example.com",
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "bm-menu-tab" }],
      "newTab",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe("bookmark:bm-menu-tab?tab=newTab");
  });

  it("allows individual item to override menuTabMode", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-override-replace",
        title: "Example 1",
        url: "https://example.com/1",
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "bm-override-replace", tabMode: "replace" }],
      "newTab",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe("bookmark:bm-override-replace");
  });

  it("allows individual item to specify newTab when menu is replace", async () => {
    vi.mocked(browser.bookmarks.getSubTree).mockResolvedValue([
      {
        id: "bm-item-newtab",
        title: "Example 2",
        url: "https://example.com/2",
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ bookmarkId: "bm-item-newtab", tabMode: "newTab" }],
      "replace",
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe("bookmark:bm-item-newtab?tab=newTab");
  });
});

