import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({
  default: {
    bookmarks: {
      getSubTree: vi.fn(),
      getTree: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

import browser from "webextension-polyfill";
import { parseBookmarkAction, type BookmarkEntry, type FolderEntry } from "@browserail/protocol";
import {
  buildSpaceDirectiveUrl,
  findBookmarkNodeByPath,
  resolveBookmarkNodeByPath,
  resolveMenuItems,
} from "./bookmarks";

describe("resolveMenuItems", () => {
  it("uses the sync bookmark snapshot and registers the browser id without re-reading the tree", async () => {
    vi.mocked(browser.bookmarks.getTree).mockClear();
    const registerTarget = vi.fn(() => "runtime-bookmark");
    const entries = await resolveMenuItems(
      [{ uid: "item-docs", path: ["Docs"], url: "https://docs.example" }],
      undefined,
      undefined,
      undefined,
      undefined,
      {
        tree: [
          {
            id: "browser-bookmark-id",
            title: "Docs",
            url: "https://docs.example",
          },
        ],
        registerTarget,
      },
    );

    expect(browser.bookmarks.getTree).not.toHaveBeenCalled();
    expect(registerTarget).toHaveBeenCalledWith("browser-bookmark-id");
    expect(entries[0]?.uid).toBe("bookmark:runtime-bookmark");
  });

  it("resolves a folder with expandOnHover set to false", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-1",
            title: "Dev Tools",
            children: [
              { id: "bm-1", title: "GitHub", url: "https://github.com" },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-dev-tools", path: ["Dev Tools"], type: "folder", expandOnHover: false },
    ]);

    expect(entries).toHaveLength(1);
    const folder = entries[0] as FolderEntry;
    expect(folder.kind).toBe("folder");
    expect(folder.expandOnHover).toBe(false);
    expect(folder.children).toHaveLength(1);
  });

  it("resolves a folder with default hover expansion", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-2",
            title: "Docs",
            children: [
              { id: "bm-2", title: "MDN", url: "https://developer.mozilla.org" },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-docs", path: ["Docs"], type: "folder" },
    ]);

    expect(entries).toHaveLength(1);
    const folder = entries[0] as FolderEntry;
    expect(folder.kind).toBe("folder");
    expect(folder.expandOnHover).toBe(true);
  });

  it("flattens a folder into individual bookmark entries when type is flattenFolder", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-3",
            title: "Quick Links",
            children: [
              { id: "bm-3", title: "GitHub", url: "https://github.com" },
              { id: "bm-4", title: "Vite", url: "https://vitejs.dev" },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-quick-links", path: ["Quick Links"], type: "flattenFolder" },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("bookmark");
    expect(entries[1]?.kind).toBe("bookmark");
  });

  it("resolves a configured menu toggle entry", async () => {
    const entries = await resolveMenuItems([
      { uid: "menu-toggle-main", type: "menuToggle" },
    ]);

    expect(entries).toEqual([
      {
        kind: "menuToggle",
        uid: "menu-toggle-main",
        label: "Fold",
      },
    ]);
  });

  it("uses a menu toggle rename as its button text", async () => {
    const entries = await resolveMenuItems([
      { uid: "menu-toggle-main", type: "menuToggle", rename: "收起" },
    ]);

    expect(entries).toEqual([
      {
        kind: "menuToggle",
        uid: "menu-toggle-main",
        label: "收起",
      },
    ]);
  });

  it("turns flattened BrowseRailSpace bookmarks into configured spaces", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-spaces",
            title: "Spaces",
            children: [
              {
                id: "space-full",
                title: "BrowseRailSpace:units=5:transparent=false:color=#cd123f",
                url: "https://example.com/space",
              },
              {
                id: "space-default",
                title: "Space",
                url: "browserail.local#Space:",
              },
              {
                id: "space-url",
                title: "Space",
                url: "https://browserail.local/#Space:units%3D2%3Atransparent%3Dfalse%3Acolor%3D%23234567",
              },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-spaces", path: ["Spaces"], type: "flattenFolder" },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      kind: "space",
      units: 5,
      color: "#cd123f",
      transparent: false,
    });
    expect(entries[1]).toMatchObject({
      kind: "space",
      units: 1,
      transparent: true,
    });
    expect(entries[2]).toMatchObject({
      kind: "space",
      units: 2,
      color: "#234567",
      transparent: false,
    });
  });

  it("creates Space bookmarks that flatten back into the configured space", async () => {
    const url = buildSpaceDirectiveUrl({ units: 5, transparent: false, color: "#cd123f" });
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-spaces",
            title: "Spaces",
            children: [{ id: "space-created", title: "Space", url }],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-spaces", path: ["Spaces"], type: "flattenFolder" },
    ]);
    expect(entries).toMatchObject([
      {
        kind: "space",
        units: 5,
        color: "#cd123f",
        transparent: false,
      },
    ]);
  });

  it("flatten skips sub-folders by default and includes them when includeFolders is set", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-mix",
            title: "Mixed",
            children: [
              { id: "bm-a", title: "GitHub", url: "https://github.com" },
              {
                id: "sub-1",
                title: "Sub",
                children: [{ id: "bm-b", title: "Vite", url: "https://vitejs.dev" }],
              },
            ],
          },
        ],
      },
    ] as any);

    const withoutFolders = await resolveMenuItems([
      { uid: "item-mixed", path: ["Mixed"], type: "flattenFolder" },
    ]);
    expect(withoutFolders).toHaveLength(1);
    expect(withoutFolders[0]?.kind).toBe("bookmark");

    const withFolders = await resolveMenuItems([
      {
        uid: "item-mixed",
        path: ["Mixed"],
        type: "flattenFolder",
        includeFolders: true,
        cycleColors: ["#22c55e"],
      },
    ]);
    expect(withFolders).toHaveLength(2);
    expect(withFolders.map((e) => e.kind).sort()).toEqual(["bookmark", "folder"]);
    // Both the flattened bookmark and the included folder take the item's cycle color.
    for (const entry of withFolders) {
      expect((entry as BookmarkEntry).color).toBe("#22c55e");
    }
    const folderEntry = withFolders.find((e) => e.kind === "folder");
    // Inside the expanded menu, children are not changed
    expect(
      folderEntry?.kind === "folder" && (folderEntry.children[0] as BookmarkEntry | undefined)?.color,
    ).toBeUndefined();
  });

  it("cycles through cycleColors for flattened items and ignores the old color field", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-cycle",
            title: "CycleTest",
            children: [
              { id: "bm-1", title: "Item 1", url: "https://item1.com" },
              { id: "bm-2", title: "Item 2", url: "https://item2.com" },
              { id: "bm-3", title: "Item 3", url: "https://item3.com" },
              { id: "bm-4", title: "Item 4", url: "https://item4.com" },
            ],
          },
        ],
      },
    ] as any);

    const result = await resolveMenuItems([
      {
        uid: "item-cycle",
        path: ["CycleTest"],
        type: "flattenFolder",
        color: "#000000", // Old color field should be completely ignored
        cycleColors: ["#ff0000", "#00ff00"],
      },
    ]);

    expect(result).toHaveLength(4);
    expect((result[0] as BookmarkEntry).color).toBe("#ff0000");
    expect((result[1] as BookmarkEntry).color).toBe("#00ff00");
    expect((result[2] as BookmarkEntry).color).toBe("#ff0000");
    expect((result[3] as BookmarkEntry).color).toBe("#00ff00");
  });

  it("resolves a folder whose title contains a slash (path segment not re-split)", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "slash-folder",
            title: "A/B",
            children: [{ id: "bm-slash", title: "GitHub", url: "https://github.com" }],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-slash", path: ["A/B"], type: "flattenFolder" },
    ]);

    // Must emit the folder's actual child, not a single fallback entry labelled "A/B".
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("bookmark");
    expect((entries[0] as BookmarkEntry).label).toBe("GitHub");
  });

  it("applies menuColor as default color to items without custom color", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          { id: "bm-color-1", title: "GitHub", url: "https://github.com" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-github", path: ["GitHub"], url: "https://github.com" }],
      "replace",
      "#10b981",
    );

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).color).toBe("#10b981");
  });

  it("preserves item custom color when menuColor is also provided", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          { id: "bm-color-2", title: "GitHub", url: "https://github.com" },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-github", path: ["GitHub"], url: "https://github.com", color: "#f59e0b" }],
      "replace",
      "#10b981",
    );

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).color).toBe("#f59e0b");
  });

  it("applies menuColor to flattened folder children when no custom color is specified", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "folder-color-flat",
            title: "Links",
            children: [
              { id: "bm-cf-1", title: "Site A", url: "https://a.com" },
              { id: "bm-cf-2", title: "Site B", url: "https://b.com" },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-links", path: ["Links"], type: "flattenFolder" }],
      "replace",
      "#8b5cf6",
    );

    expect(entries).toHaveLength(2);
    expect((entries[0] as BookmarkEntry).color).toBe("#8b5cf6");
    expect((entries[1] as BookmarkEntry).color).toBe("#8b5cf6");
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

  it("uses the saved URL to disambiguate duplicate bookmark paths and reports the duplicate", () => {
    const duplicateTree = [
      {
        id: "root",
        title: "Bookmarks Toolbar",
        children: [
          { id: "first", title: "Docs", url: "https://first.example" },
          { id: "second", title: "Docs", url: "https://second.example" },
        ],
      },
    ];

    expect(
      resolveBookmarkNodeByPath(
        duplicateTree,
        ["Bookmarks Toolbar", "Docs"],
        "https://second.example",
      ),
    ).toEqual({ node: duplicateTree[0]?.children?.[1], duplicatePath: true });
    expect(
      resolveBookmarkNodeByPath(duplicateTree, ["Bookmarks Toolbar", "Docs"]),
    ).toEqual({ duplicatePath: true });
  });

  it("strictly rejects folder path that does not exist without fuzzy searching other folders", () => {
    const found = findBookmarkNodeByPath(tree, ["Bookmarks Toolbar", "RandomFolder", "Dev"]);
    expect(found).toBeUndefined();
  });
});

describe("rename and emoji support", () => {
  it("uses custom rename when configured on StoredMenuItem", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-custom-rename",
            title: "Very Long GitHub Bookmark Title",
            url: "https://github.com",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-rename", path: ["Very Long GitHub Bookmark Title"], url: "https://github.com", rename: "GH" },
    ]);

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).rename).toBe("GH");
    expect((entries[0] as BookmarkEntry).label).toBe("Very Long GitHub Bookmark Title");
  });

  it("uses custom rename with emoji on StoredMenuItem", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-custom-emoji-rename",
            title: "GitHub",
            url: "https://github.com",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-rename-emoji", path: ["GitHub"], url: "https://github.com", rename: "🐙" },
    ]);

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).rename).toBe("🐙");
    expect((entries[0] as BookmarkEntry).label).toBe("GitHub");
  });

  it("does not automatically extract leading emoji when no custom rename is configured", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-title-emoji",
            title: "📁工作台",
            url: "https://prod.example.com",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems([
      { uid: "item-title-emoji", path: ["📁工作台"], url: "https://prod.example.com" },
    ]);

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).rename).toBeUndefined();
    expect((entries[0] as BookmarkEntry).label).toBe("📁工作台");
  });
});

describe("tabMode configuration", () => {
  it("defaults to standard actionUid when tabMode is replace or unspecified", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-replace",
            title: "Example",
            url: "https://example.com",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-replace", path: ["Example"], url: "https://example.com" }],
      undefined,
      undefined,
      undefined,
      undefined,
      { registerTarget: (browserBookmarkId) => `runtime-${browserBookmarkId}` },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.uid).toBe("bookmark:runtime-bm-replace");
  });

  it("inherits newTab tabMode from menuTabMode", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-menu-tab",
            title: "Example",
            url: "https://example.com",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-menu-tab", path: ["Example"], url: "https://example.com" }],
      "newTab",
    );

    expect(entries).toHaveLength(1);
    expect(parseBookmarkAction(entries[0]?.uid ?? "").tabMode).toBe("newTab");
  });

  it("allows individual item to override menuTabMode", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-override-replace",
            title: "Example 1",
            url: "https://example.com/1",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-override", path: ["Example 1"], url: "https://example.com/1", tabMode: "replace" }],
      "newTab",
    );

    expect(entries).toHaveLength(1);
    expect(parseBookmarkAction(entries[0]?.uid ?? "").tabMode).toBe("replace");
  });

  it("allows individual item to specify newTab when menu is replace", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "bm-item-newtab",
            title: "Example 2",
            url: "https://example.com/2",
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-item-newtab", path: ["Example 2"], url: "https://example.com/2", tabMode: "newTab" }],
      "replace",
    );

    expect(entries).toHaveLength(1);
    expect(parseBookmarkAction(entries[0]?.uid ?? "").tabMode).toBe("newTab");
  });

  it("preserves invalid items as noop entries when rootPrefix is /书签栏 and item path is 书签栏", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [
              { id: "bm-gbf", title: "gbfsync", url: "https://gbf.wiki" },
            ],
          },
        ],
      },
    ] as any);

    // /书签栏 + /书签栏 = /书签栏/书签栏 -> does not exist under 书签栏
    const entries = await resolveMenuItems(
      [{ uid: "item-root", path: ["书签栏"], rename: "我的书签栏" }],
      "replace",
      "#ff0000",
      undefined,
      ["书签栏"],
    );

    expect(entries).toHaveLength(1);
    expect((entries[0] as BookmarkEntry).label).toBe("书签栏");
    expect((entries[0] as BookmarkEntry).rename).toBe("我的书签栏");
    expect((entries[0] as BookmarkEntry).color).toBe("#ff0000");
    expect(entries[0]?.uid).toMatch(/^noop:/);
  });

  it("resolves /书签栏/gbfsync when rootPrefix is /书签栏 and item is gbfsync", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [
              { id: "bm-gbf", title: "gbfsync", url: "https://gbf.wiki" },
            ],
          },
        ],
      },
    ] as any);

    const entries = await resolveMenuItems(
      [{ uid: "item-gbfsync", path: ["gbfsync"] }],
      "replace",
      undefined,
      undefined,
      ["书签栏"],
    );

    expect(entries).toHaveLength(1);
    expect(parseBookmarkAction(entries[0]?.uid ?? "").tabMode).toBe("replace");
  });
});

describe("normalizeStoredMenuItem and normalizeMenu portable support", () => {
  it("normalizes a portable item from its path, type, and settings", async () => {
    const { normalizeStoredMenuItem } = await import("./config");
    const item = normalizeStoredMenuItem({
      type: "flattenFolder",
      path: ["Bookmarks Toolbar", "Dev"],
      rename: "Devs",
      color: "#2563eb",
      tabMode: "newTab",
    });

    expect(item).toBeDefined();
    expect(item?.type).toBe("flattenFolder");
    expect(item?.path).toEqual(["Bookmarks Toolbar", "Dev"]);
    expect(item?.rename).toBe("Devs");
    expect(item?.color).toBe("#2563eb");
    expect(item?.tabMode).toBe("newTab");
  });

  it("preserves future custom types", async () => {
    const { normalizeStoredMenuItem } = await import("./config");
    const item = normalizeStoredMenuItem({
      type: "customPluginType",
      path: ["Tools"],
    });

    expect(item).toBeDefined();
    expect(item?.type).toBe("customPluginType");
  });

  it("normalizes a space item with units and transparency", async () => {
    const { normalizeStoredMenuItem } = await import("./config");
    const item = normalizeStoredMenuItem({
      type: "space",
      units: 2.5,
      color: "#ff0000",
      transparent: false,
    });

    expect(item).toBeDefined();
    expect(item?.type).toBe("space");
    expect(item?.units).toBe(2.5);
    expect(item?.color).toBe("#ff0000");
    expect(item?.transparent).toBe(false);
    expect(typeof item?.uid).toBe("string");
    expect(item?.uid.length).toBeGreaterThan(0);
  });

  it("keeps only the first menu toggle when normalizing a menu", async () => {
    const { normalizeMenu } = await import("./config");
    const menu = normalizeMenu({
      uid: "menu-toggle-menu",
      items: [
        { uid: "toggle-1", type: "menuToggle" },
        { uid: "toggle-2", type: "menuToggle" },
      ],
    });

    expect(menu?.items).toHaveLength(1);
    expect(menu?.items[0]?.type).toBe("menuToggle");
  });

  it("preserves up and left expansion directions", async () => {
    const { normalizeMenu } = await import("./config");
    const upMenu = normalizeMenu({
      uid: "menu-up",
      orientation: "row",
      expandDirection: "up",
      items: [],
    });
    const leftMenu = normalizeMenu({
      uid: "menu-left",
      orientation: "column",
      expandDirection: "left",
      items: [],
    });

    expect(upMenu?.expandDirection).toBe("up");
    expect(leftMenu?.expandDirection).toBe("left");
  });

  it("preserves a menu toggle rename while normalizing settings", async () => {
    const { normalizeStoredMenuItem } = await import("./config");
    const item = normalizeStoredMenuItem({
      uid: "toggle-1",
      type: "menuToggle",
      rename: "收起",
    });

    expect(item).toEqual({
      uid: "toggle-1",
      type: "menuToggle",
      rename: "收起",
    });
  });
});

describe("combineRootAndItemPath and space resolution", () => {
  it("combines root prefix with item path strictly without deduplication", async () => {
    const { combineRootAndItemPath } = await import("./bookmarks");

    // Root prefix combined with relative item path
    expect(combineRootAndItemPath(["书签栏"], ["gbfsync"])).toEqual(["书签栏", "gbfsync"]);
    expect(combineRootAndItemPath(["书签栏"], ["Work", "Docs"])).toEqual(["书签栏", "Work", "Docs"]);

    // Strictly concatenate without deduplicating prefix
    expect(combineRootAndItemPath(["书签栏"], ["书签栏", "gbfsync"])).toEqual(["书签栏", "书签栏", "gbfsync"]);
    expect(combineRootAndItemPath(["书签栏"], ["Bookmarks bar", "gbfsync"])).toEqual(["书签栏", "Bookmarks bar", "gbfsync"]);
  });

  it("resolves space items into SpaceEntry without querying bookmarks", async () => {
    const entries = await resolveMenuItems([
      {
        uid: "space-1",
        type: "space",
        units: 2,
        color: "#ffffff",
      },
      {
        uid: "space-2",
        type: "space",
        units: 1,
        color: "#ff0000",
        transparent: false,
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      kind: "space",
      uid: "space-1",
      units: 2,
      transparent: true,
    });
    expect(entries[1]).toEqual({
      kind: "space",
      uid: "space-2",
      units: 1,
      color: "#ff0000",
      transparent: false,
    });
  });

  it("calculates item relative path correctly based on root prefix", async () => {
    const { getFolderPath, getItemRelativePath, findBookmarkNodeByPath, combineRootAndItemPath } = await import("./bookmarks");

    const tree = [
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [
              {
                id: "10",
                title: "Dev",
                children: [
                  { id: "100", title: "Tool", url: "https://tool.internal" },
                ],
              },
              { id: "11", title: "GitHub", url: "https://github.com" },
            ],
          },
          {
            id: "2",
            title: "其他书签",
            children: [{ id: "20", title: "Read Later", url: "https://read.it" }],
          },
        ],
      },
    ];

    // getFolderPath returns full chain
    const folderPath = getFolderPath("100", tree);
    expect(folderPath.map((n) => n.id)).toEqual(["0", "1", "10", "100"]);

    // Relative path with no root prefix -> full path using special root placeholder
    expect(getItemRelativePath("100", tree, [])).toEqual(["${bookmarks-bar}", "Dev", "Tool"]);
    expect(getItemRelativePath("11", tree, undefined)).toEqual(["${bookmarks-bar}", "GitHub"]);
    expect(getItemRelativePath("20", tree, [])).toEqual(["${other}", "Read Later"]);

    // Relative path with root prefix ["书签栏"] or ["${bookmarks-bar}"]
    expect(getItemRelativePath("100", tree, ["书签栏"])).toEqual(["Dev", "Tool"]);
    expect(getItemRelativePath("100", tree, ["${bookmarks-bar}"])).toEqual(["Dev", "Tool"]);
    expect(getItemRelativePath("10", tree, ["书签栏"])).toEqual(["Dev"]);
    expect(getItemRelativePath("11", tree, ["书签栏"])).toEqual(["GitHub"]);

    // Relative path with nested root prefix ["书签栏", "Dev"]
    expect(getItemRelativePath("100", tree, ["书签栏", "Dev"])).toEqual(["Tool"]);

    // Relative path when selecting the root folder itself -> empty path []
    expect(getItemRelativePath("1", tree, ["书签栏"])).toEqual([]);
    expect(getItemRelativePath("1", tree, ["${bookmarks-bar}"])).toEqual([]);
    expect(combineRootAndItemPath(["书签栏"], [])).toEqual(["书签栏"]);
    const rootMatch = findBookmarkNodeByPath(tree, combineRootAndItemPath(["书签栏"], []));
    expect(rootMatch?.id).toBe("1");

    // Resolving via special root placeholder
    expect(findBookmarkNodeByPath(tree, ["${bookmarks-bar}", "Dev", "Tool"])?.id).toBe("100");
    expect(findBookmarkNodeByPath(tree, ["${other}", "Read Later"])?.id).toBe("20");

    // Combined relative path with root prefix resolves the exact node
    const relPath = getItemRelativePath("100", tree, ["书签栏"])!;
    const combined = combineRootAndItemPath(["书签栏"], relPath);
    expect(combined).toEqual(["书签栏", "Dev", "Tool"]);
    const foundNode = findBookmarkNodeByPath(tree, combined);
    expect(foundNode?.id).toBe("100");
  });

  it("resolves an item with empty path [] as the root directory folder", async () => {
    vi.mocked(browser.bookmarks.getTree).mockResolvedValue([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [
              { id: "100", title: "GitHub", url: "https://github.com" },
            ],
          },
        ],
      },
    ] as any);

    const { normalizeStoredMenuItem } = await import("./config");
    const normalized = normalizeStoredMenuItem({
      path: [],
      type: "folder",
    });
    expect(normalized).toBeDefined();
    expect(normalized?.path).toEqual([]);

    const entries = await resolveMenuItems(
      [{ uid: "item-root-empty", path: [], type: "folder" }],
      undefined,
      undefined,
      undefined,
      ["书签栏"],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("folder");
    expect((entries[0] as FolderEntry).label).toBe("书签栏");
  });

  it("handles Chrome special root folder set: bookmarks-bar, other, mobile, managed", async () => {
    const {
      getItemRelativePath,
      findBookmarkNodeByPath,
      formatSpecialRootForDisplay,
    } = await import("./bookmarks");
    const { DEFAULT_BOOKMARK_ROOT_PREFIX, loadBookmarkRootPrefix } = await import("./config");

    expect(DEFAULT_BOOKMARK_ROOT_PREFIX).toEqual([]);

    const chromeTree = [
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "书签栏",
            children: [{ id: "10", title: "GitHub", url: "https://github.com" }],
          },
          {
            id: "2",
            title: "其他书签",
            children: [{ id: "20", title: "Docs", url: "https://docs.com" }],
          },
          {
            id: "3",
            title: "移动设备书签",
            children: [{ id: "30", title: "Article", url: "https://article.com" }],
          },
          {
            id: "managed",
            title: "受管理书签",
            children: [{ id: "40", title: "Intranet", url: "https://corp.internal" }],
          },
        ],
      },
    ];

    // Empty root prefix generates special root placeholders
    expect(getItemRelativePath("10", chromeTree, [])).toEqual(["${bookmarks-bar}", "GitHub"]);
    expect(getItemRelativePath("20", chromeTree, [])).toEqual(["${other}", "Docs"]);
    expect(getItemRelativePath("30", chromeTree, [])).toEqual(["${mobile}", "Article"]);
    expect(getItemRelativePath("40", chromeTree, [])).toEqual(["${managed}", "Intranet"]);

    // Resolving via special root placeholder
    expect(findBookmarkNodeByPath(chromeTree, ["${bookmarks-bar}", "GitHub"])?.id).toBe("10");
    expect(findBookmarkNodeByPath(chromeTree, ["${other}", "Docs"])?.id).toBe("20");
    expect(findBookmarkNodeByPath(chromeTree, ["${mobile}", "Article"])?.id).toBe("30");
    expect(findBookmarkNodeByPath(chromeTree, ["${managed}", "Intranet"])?.id).toBe("40");

    // UI display formatting retrieves title from Chrome tree
    expect(formatSpecialRootForDisplay("${bookmarks-bar}", chromeTree)).toBe("书签栏");
    expect(formatSpecialRootForDisplay("${other}", chromeTree)).toBe("其他书签");
    expect(formatSpecialRootForDisplay("${mobile}", chromeTree)).toBe("移动设备书签");
    expect(formatSpecialRootForDisplay("${managed}", chromeTree)).toBe("受管理书签");

    // A stored string (non-array) is ignored, falling back to the whole tree
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      bookmark_root_prefix: "/Work/Docs",
    });
    expect(await loadBookmarkRootPrefix()).toEqual([]);
    // A stored array is used as-is, so a title containing "/" stays one segment
    vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
      bookmark_root_prefix: ["Work", "A/B"],
    });
    expect(await loadBookmarkRootPrefix()).toEqual(["Work", "A/B"]);
  });
});
