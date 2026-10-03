import { beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { customBookmarkReference, customBookmarkUid, formatActionUid, invertNavigationActionUid } from "@browserail/protocol";
import { loadConfig, saveConfig, saveSyncEnabled, saveTemporaryValue, SYNC_CONFIG_KEY } from "../config";
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
  ], undefined, undefined, undefined, undefined, {
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

it("syncs definitions and menu references across installations while keeping temporary values and shortcuts local", async () => {
  await saveSyncEnabled(true);
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "static", name: "Docs", url: "https://example.com/docs" }];
  config.temporaryBookmarks = [{ uid: "temporary", name: "Later" }];
  config.dynamicBookmarks = [{ uid: "dynamic", name: "Script", code: "return { newUrl: null };" }];
  config.panel.menus = [{ uid: "menu", items: [
    { uid: "one", ...customBookmarkReference("static", "static") },
    { uid: "two", ...customBookmarkReference("temporary", "temporary") },
  ] }];
  config.shortcuts = [{ slot: "slot_1", ...customBookmarkReference("static", "static") }];
  config.nativeShortcuts = [{ id: "key", key: "Ctrl+K", ...customBookmarkReference("temporary", "temporary") }];
  await saveTemporaryValue("temporary", "https://private.example", "Private note");
  await saveConfig(config);
  const current = await loadConfig();
  expect(current.shortcuts).toEqual(config.shortcuts);
  expect(current.nativeShortcuts).toEqual(config.nativeShortcuts);
  expect(JSON.stringify(sync[SYNC_CONFIG_KEY])).not.toContain("private.example");
  expect(JSON.stringify(sync[SYNC_CONFIG_KEY])).not.toContain("Private note");
  local = { sync_enabled: true };
  const restored = await loadConfig();
  expect(restored.staticBookmarks).toEqual(config.staticBookmarks);
  expect(restored.temporaryBookmarks).toEqual(config.temporaryBookmarks);
  expect(restored.dynamicBookmarks).toEqual(config.dynamicBookmarks);
  expect(restored.panel.menus[0]!.items).toEqual(config.panel.menus[0]!.items);
  expect(restored.shortcuts).toEqual([]);
  expect(restored.nativeShortcuts).toEqual([]);
});

it("resolves a static menu button without a browser bookmark and does not send its URL to Native", async () => {
  const definitions = [{ uid: "docs", name: "Documentation", url: "https://private.example/docs" }];
  const entries = await resolveMenuItems([
    { uid: "button", type: "static", staticUid: "docs" },
    { uid: "missing", type: "static", staticUid: "deleted" },
  ], undefined, undefined, undefined, undefined, {
    staticBookmarks: definitions,
  });
  expect(entries).toMatchObject([{ label: "Documentation", uid: "static:docs" }]);
  expect(entries).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain("https://private.example/docs");
});
