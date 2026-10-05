import { beforeEach, expect, it, vi } from "vitest";
import { defaultNativeBarSettings, invertNavigationActionUid, parseTemporaryAction, type FolderEntry } from "@browserail/protocol";
import { barDimensions } from "@browserail/menu-ui";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  tree: [] as Array<{ id: string; title: string; children: Array<{ id: string; title: string; url: string }> }>,
  update: vi.fn(), create: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: { local: {
    get: async (key: string) => ({ [key]: mocks.storage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.storage, values); },
  } },
  bookmarks: {
    getTree: async () => mocks.tree,
    get: async (id: string) => mocks.tree.flatMap(folder => folder.children).filter(node => node.id === id),
  },
  tabs: { query: async () => [{ id: 17, url: "https://current.example" }], update: mocks.update, create: mocks.create },
  windows: { get: async () => ({}) },
} }));

import { loadConfig, saveConfig, saveDynamicValue, loadTemporaryValues, loadTemporaryNotes, saveBarLayout, loadBarConfigurations, importBarConfigurations, defaultMenuPlacement, type StoredMenuItem } from "../config";
import { buildTemporaryDirectiveUrl, resolveMenuItems } from "../bookmarks";
import { projectMenuSpacing } from "../bookmarks/spacing";
import { executeMenuAction } from "./execute-menu-action";

beforeEach(() => {
  mocks.storage = {}; mocks.tree = []; mocks.update.mockClear(); mocks.create.mockClear();
});

it("opens configured bookmarks and expanded children without a persisted target registry", async () => {
  mocks.tree = [{ id: "folder-id", title: "Tools", children: [{ id: "actual-id", title: "Docs", url: "https://docs.example" }] }];
  const config = await loadConfig();
  config.panel.menus = [{ uid: "menu", items: [
    { uid: "docs#copy", path: ["Tools", "Docs"] },
    { uid: "folder", path: ["Tools"] },
  ] }];
  await saveConfig(config);
  const entries = await resolveMenuItems(config.panel.menus[0]!.items);
  await executeMenuAction(entries[0]!.uid, "menu", "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://docs.example" });
  const child = (entries[1] as FolderEntry).children[0]!;
  await executeMenuAction(invertNavigationActionUid(child.uid), "menu", "42", () => {});
  expect(mocks.create).toHaveBeenLastCalledWith({ active: true, windowId: 42, url: "https://docs.example" });
});

it("keeps duplicated custom buttons distinct while opening the shared definition and shortcut target", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "definition", name: "Docs", url: "https://docs.example" }];
  config.panel.menus = [{ uid: "menu", items: [
    { uid: "first", type: "static", staticUid: "definition" },
    { uid: "second", type: "static", staticUid: "definition", tabMode: "newTab" },
  ] }];
  await saveConfig(config);
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  expect(entries[0]!.uid).not.toBe(entries[1]!.uid);
  await executeMenuAction(entries[0]!.uid, "menu", "42", () => {});
  await executeMenuAction(entries[1]!.uid, "menu", "42", () => {});
  await executeMenuAction("static:definition", undefined, "42", () => {});
  expect(mocks.update).toHaveBeenCalledTimes(2);
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://docs.example" });
  expect(mocks.create).toHaveBeenLastCalledWith({ active: true, windowId: 42, url: "https://docs.example" });
});

it("opens flattened dynamic markers and saves confirmed temporary markers to their definitions", async () => {
  const config = await loadConfig();
  config.temporaryBookmarks = [{ uid: "slot", name: "Later" }];
  config.panel.menus = [{ uid: "menu", items: [{ uid: "flat", type: "flattenFolder", path: ["Tools"] }] }];
  mocks.tree = [{ id: "folder", title: "Tools", children: [
    { id: "temporary-marker", title: "Later", url: buildTemporaryDirectiveUrl({ id: "slot" }) },
    { id: "dynamic-marker", title: "Recent", url: "https://browserail.local/#Dynamic:recent" },
  ] }];
  await saveConfig(config);
  await saveDynamicValue("recent", { url: "https://recent.example", updatedAt: 1 });
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, undefined, {
    temporaryBookmarks: config.temporaryBookmarks, dynamicResolve: uid => uid === "recent" ? { name: "Recent", url: "https://recent.example" } : undefined,
  });
  expect(entries).toHaveLength(2);
  await executeMenuAction(entries[1]!.uid, "menu", "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://recent.example" });
  const { uid } = parseTemporaryAction(entries[0]!.uid);
  await executeMenuAction(`temporarySave:${encodeURIComponent(uid)}?confirmed=1&note=Saved`, "menu", "42", () => {});
  expect(await loadTemporaryValues()).toEqual({ slot: "https://current.example" });
  expect(await loadTemporaryNotes()).toEqual({ slot: "Saved" });
});

it("restores independent gaps after layout import into a browser with different bookmark IDs", async () => {
  const config = await loadConfig();
  const items: StoredMenuItem[] = [
    { uid: "flat-one", type: "flattenFolder", path: ["Tools"] },
    { uid: "flat-two", type: "flattenFolder", path: ["Tools"], tabMode: "newTab" },
  ];
  config.panel.menus = [{ uid: "menu", items }];
  await saveConfig(config);
  mocks.tree = [{ id: "chrome-folder", title: "Tools", children: [
    { id: "chrome-1", title: "Docs/API", url: "https://one.example" },
    { id: "chrome-2", title: "Docs/API", url: "https://two.example" },
    { id: "chrome-3", title: "Other", url: "https://other.example" },
  ] }];
  const entries = await resolveMenuItems(items);
  await saveBarLayout("menu", "native", defaultMenuPlacement(), {
    gapRatio: 0.1, extraGaps: { [entries[0]!.uid]: 0.2, [entries[1]!.uid]: 0.4, [entries[3]!.uid]: 0.6 },
  }, defaultNativeBarSettings());
  const exported = JSON.parse(JSON.stringify(await loadBarConfigurations()));
  mocks.storage.bar_configurations = {};
  mocks.tree[0]!.id = "firefox-folder";
  mocks.tree[0]!.children.forEach((node, index) => { node.id = `firefox-${index}`; });
  items[1]!.tabMode = "replace";
  await importBarConfigurations(exported, ["menu"]);
  const imported = (await loadBarConfigurations()).native.menu!;
  const rendered = await resolveMenuItems(items);
  const view = { ...imported, ...projectMenuSpacing(imported, items, rendered, mocks.tree, []), uid: "menu", items: rendered };
  expect(view.extraGaps).toEqual({ [rendered[0]!.uid]: 0.2, [rendered[1]!.uid]: 0.4, [rendered[3]!.uid]: 0.6 });
  expect(barDimensions({ ...view, orientation: "column" }, { width: 80, height: 40 }).height).toBeCloseTo(308);
});
