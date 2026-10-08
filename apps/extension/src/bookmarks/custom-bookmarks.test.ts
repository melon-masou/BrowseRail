import { beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { customBookmarkReference, customBookmarkUid, formatActionUid, invertNavigationActionUid, type FolderEntry } from "@browserail/protocol";
import { loadConfig, saveConfig, saveTemporaryValue } from "../config";
import { resolveMenuItems } from "./index";
import { executeMenuAction } from "../background/execute-menu-action";

let local: Record<string, unknown> = {};
let sync: Record<string, unknown> = {};
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: local[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(local, data); }),
    },
    sync: {
      get: vi.fn(async (key: string) => ({ [key]: sync[key] })),
      set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(sync, data); }),
    },
  },
  bookmarks: { getTree: vi.fn(async () => []) },
  windows: { get: vi.fn(async () => ({})) },
  tabs: {
    query: vi.fn(async () => [{ id: 42 }]),
    update: vi.fn(async () => ({})),
    create: vi.fn(async () => ({})),
  },
} }));

beforeEach(() => { local = {}; sync = {}; vi.clearAllMocks(); });

it("applies an item's CSS classes to its generated bar buttons without passing them into folder children", async () => {
  const tree = [{ id: "folder", title: "Folder", children: [
    { id: "docs", title: "Docs", url: "https://example.com" },
    { id: "sub", title: "Sub", children: [{ id: "child", title: "Child", url: "https://example.com/child" }] },
  ] }];
  const items = [
    { uid: "group", type: "folder", path: ["Folder"], cssClass: "folder-style" },
    { uid: "flat", type: "flattenFolder", path: ["Folder"], includeFolders: true, cssClass: "icon-home compact" },
    { uid: "tags", type: "flattenStaticTag", staticTag: "work", cssClass: "tag-style" },
    { uid: "reload", type: "browserAction", browserAction: "reload" as const, cssClass: "action-style" },
  ];
  const entries = await resolveMenuItems(items, undefined, undefined, undefined, {
    tree, staticBookmarks: [{ uid: "static", name: "Static", tags: ["work"] }],
  });
  expect(entries.map(entry => entry.cssClass)).toEqual(["folder-style", "icon-home compact", "icon-home compact", "tag-style", "action-style"]);
  const folders = entries.filter(entry => entry.kind === "folder");
  expect(folders.flatMap(folder => folder.children).every(child => child.cssClass === undefined)).toBe(true);
});

it("renders a tag as a folder with the same child actions as its flattened form", async () => {
  const item = { uid: "group", type: "staticTag", staticTag: "work", rename: "Work links", color: "#123456ff", expandOnHover: false };
  const context = { bookmarksAvailable: false, staticBookmarks: [{ uid: "docs", name: "Docs", tags: ["work"] }] };
  const [entry] = await resolveMenuItems([item], undefined, "left", undefined, context);
  expect(entry).toMatchObject({ kind: "folder", label: "work", rename: "Work links", color: "#123456ff", expandOnHover: false, expandDirection: "left" });
  const flattened = await resolveMenuItems([{ ...item, type: "flattenStaticTag" }], undefined, "left", undefined, context);
  expect((entry as FolderEntry).children).toEqual(flattened);
  const [empty] = await resolveMenuItems([item], undefined, undefined, undefined, { bookmarksAvailable: false, staticBookmarks: [] });
  expect(empty).toMatchObject({ kind: "folder", children: [] });
});

it("flattens a tag in static bookmark order and follows membership changes without browser bookmarks", async () => {
  const items = [{ uid: "work/group", type: "flattenStaticTag", staticTag: "work" }];
  const a = { uid: "a", name: "A", tags: ["work"] };
  const b = { uid: "b", name: "B", tags: ["other"] };
  const c = { uid: "c", name: "C", tags: ["work", "other"] };
  const first = await resolveMenuItems(items, "#123456ff", undefined, undefined, { staticBookmarks: [a, b, c], bookmarksAvailable: false });
  expect(first).toEqual([
    expect.objectContaining({ kind: "bookmark", label: "A", color: "#123456ff" }),
    expect.objectContaining({ kind: "bookmark", label: "C", color: "#123456ff" }),
  ]);
  const next = await resolveMenuItems(items, undefined, undefined, undefined, { staticBookmarks: [c, b, { ...a, tags: [] }], bookmarksAvailable: false });
  expect(next.map(entry => entry.kind === "bookmark" ? entry.label : undefined)).toEqual(["C"]);
  expect(next[0]!.uid).toBe(first[1]!.uid);
  expect(await resolveMenuItems(items, undefined, undefined, undefined, { staticBookmarks: [], bookmarksAvailable: false })).toEqual([]);
  expect(browser.bookmarks.getTree).not.toHaveBeenCalled();
});

it("opens a static definition's current URL in the source window, including alternate tab mode", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "shared/link", name: "Docs", url: "https://example.com/old" }];
  await saveConfig(config);
  const action = formatActionUid("static", "shared/link");
  await executeMenuAction(action, undefined, "12", vi.fn());
  expect(browser.tabs.update).toHaveBeenLastCalledWith(42, { url: "https://example.com/old" });
  config.staticBookmarks[0]!.url = "https://example.com/new";
  await saveConfig(config);
  await executeMenuAction(invertNavigationActionUid(action), undefined, "12", vi.fn());
  expect(browser.tabs.create).toHaveBeenLastCalledWith({ active: true, windowId: 12, url: "https://example.com/new" });
});

it("shares a temporary slot across menu buttons and shortcuts without exposing its URL in render data", async () => {
  const config = await loadConfig();
  config.temporaryBookmarks = [{ uid: "slot", name: "Later" }];
  config.shortcuts = [{ slot: "slot_1", ...customBookmarkReference("temporary", "slot") }];
  await saveConfig(config);
  await saveTemporaryValue("slot", "https://private.example/first", "First note");
  const entries = await resolveMenuItems([
    { uid: "button-a", type: "temporary", temporaryUid: "slot" },
    { uid: "button-b", type: "temporary", temporaryUid: "slot" },
  ], undefined, undefined, undefined, {
    temporaryBookmarks: config.temporaryBookmarks, temporaryNotes: { slot: "First note" },
  });
  expect(entries.map(entry => entry.kind === "bookmark" ? entry.label : undefined)).toEqual(["First note", "First note"]);
  expect(JSON.stringify(entries)).not.toContain("https://private.example");
  const shortcut = (await loadConfig()).shortcuts[0]!;
  const action = formatActionUid("temporary", customBookmarkUid(shortcut)!);
  await executeMenuAction(action, undefined, "12", vi.fn());
  expect(browser.tabs.update).toHaveBeenLastCalledWith(42, { url: "https://private.example/first" });
  await saveTemporaryValue("slot", "https://private.example/second", "Second note");
  await executeMenuAction(action, undefined, "12", vi.fn());
  expect(browser.tabs.update).toHaveBeenLastCalledWith(42, { url: "https://private.example/second" });
  config.temporaryBookmarks = [];
  await saveConfig(config);
  vi.mocked(browser.tabs.update).mockClear();
  await executeMenuAction(action, undefined, "12", vi.fn());
  expect(browser.tabs.update).not.toHaveBeenCalled();
});

it("ordinary saves keep bookmark definitions and temporary values local without publishing to the cloud", async () => {
  local.sync_enabled = true;
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "static", name: "Docs", url: "https://example.com/docs" }];
  config.temporaryBookmarks = [{ uid: "temporary", name: "Later" }];
  config.panel.menus = [{ uid: "menu", items: [{ uid: "one", ...customBookmarkReference("static", "static") }] }];
  await saveTemporaryValue("temporary", "https://private.example", "Private note");
  await saveConfig(config);
  expect((await loadConfig()).staticBookmarks).toEqual(config.staticBookmarks);
  expect(browser.storage.sync.get).not.toHaveBeenCalled();
  expect(browser.storage.sync.set).not.toHaveBeenCalled();
});

it("resolves a static menu button without a browser bookmark and does not send its URL to Native", async () => {
  const definitions = [{ uid: "docs", name: "Documentation", url: "https://private.example/docs" }];
  const entries = await resolveMenuItems([
    { uid: "button", type: "static", staticUid: "docs" },
    { uid: "missing", type: "static", staticUid: "deleted" },
  ], undefined, undefined, undefined, {
    staticBookmarks: definitions,
  });
  expect(entries).toMatchObject([{ label: "Documentation", uid: "static:button" }]);
  expect(entries).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain("https://private.example/docs");
});
