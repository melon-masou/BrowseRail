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
import { saveExternalData } from "../config/external-data";
import { executeMenuAction } from "./execute-menu-action";

beforeEach(() => {
  mocks.storage = {}; mocks.tree = []; mocks.update.mockClear(); mocks.create.mockClear();
});

it("opens current tagged static definitions with variables and rejects buttons whose tag was removed", async () => {
  const config = await loadConfig();
  config.userVariables = { owner: "alice" };
  config.staticBookmarks = [{ uid: "link/#?", name: "Owner", url: "https://github.com/${user.owner}", tags: ["work"] }];
  config.panel.menus = [{ uid: "menu", items: [{ uid: "group/#", type: "flattenStaticTag", staticTag: "work" }] }];
  await saveConfig(config);
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  await executeMenuAction(entries[0]!.uid, "menu", "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://github.com/alice" });
  config.panel.menus[0]!.items[0]!.type = "staticTag";
  await saveConfig(config);
  const [folder] = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  await executeMenuAction((folder as FolderEntry).children[0]!.uid, "menu", "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://github.com/alice" });
  config.userVariables.owner = "bob";
  await saveConfig(config);
  await executeMenuAction(invertNavigationActionUid(entries[0]!.uid), "menu", "42", () => {});
  expect(mocks.create).toHaveBeenLastCalledWith({ active: true, windowId: 42, url: "https://github.com/bob" });
  config.staticBookmarks[0]!.tags = [];
  await saveConfig(config);
  mocks.update.mockClear();
  await expect(executeMenuAction(entries[0]!.uid, "menu", "42", () => {})).rejects.toThrow("tag group");
  expect(mocks.update).not.toHaveBeenCalled();
});

it("restores distinct tag-group gaps after reorder and import without reading the browser bookmark tree", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [
    { uid: "a", name: "A", url: "https://a.example", tags: ["work"] },
    { uid: "b/#", name: "B", url: "https://b.example", tags: ["work"] },
  ];
  const items = [
    { uid: "group-one", type: "flattenStaticTag", staticTag: "work" },
    { uid: "group-two", type: "flattenStaticTag", staticTag: "work" },
  ];
  config.panel.menus = [{ uid: "menu", items }];
  await saveConfig(config);
  const entries = await resolveMenuItems(items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  const spacing = { gapRatio: 0.1, extraGaps: { [entries[1]!.uid]: 0.2, [entries[3]!.uid]: 0.5 } };
  const getTree = vi.spyOn((await import("webextension-polyfill")).default.bookmarks, "getTree").mockRejectedValue(new Error("Bookmarks unavailable"));
  try {
    await saveBarLayout("menu", "native", defaultMenuPlacement(), spacing, defaultNativeBarSettings());
    const exported = JSON.parse(JSON.stringify(await loadBarConfigurations()));
    await importBarConfigurations(exported, ["menu"]);
    config.staticBookmarks.reverse();
    const reordered = await resolveMenuItems(items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
    const imported = (await loadBarConfigurations()).native.menu!;
    expect(projectMenuSpacing(imported, items, reordered, [], []).extraGaps).toEqual({ [reordered[0]!.uid]: 0.2, [reordered[2]!.uid]: 0.5 });
    expect(getTree).not.toHaveBeenCalled();
  } finally { getTree.mockRestore(); }
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

it("keeps duplicate buttons distinct and uses fixed click actions despite obsolete open modes", async () => {
  mocks.storage.config = {
    staticBookmarks: [{ uid: "definition", name: "Docs", url: "https://docs.example" }],
    panel: { menus: [{ uid: "menu", tabMode: "newTab", items: [
      { uid: "first", type: "static", staticUid: "definition", tabMode: "newTab" },
      { uid: "second", type: "static", staticUid: "definition", tabMode: "newTab" },
    ] }] },
  };
  const config = await loadConfig();
  await saveConfig(config);
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  expect(entries[0]!.uid).not.toBe(entries[1]!.uid);
  await executeMenuAction(entries[0]!.uid, "menu", "42", () => {});
  await executeMenuAction(invertNavigationActionUid(entries[1]!.uid), "menu", "42", () => {});
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
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, {
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
    { uid: "flat-two", type: "flattenFolder", path: ["Tools"] },
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
  await importBarConfigurations(exported, ["menu"]);
  const imported = (await loadBarConfigurations()).native.menu!;
  const rendered = await resolveMenuItems(items);
  const view = { ...imported, ...projectMenuSpacing(imported, items, rendered, mocks.tree, []), uid: "menu", items: rendered };
  expect(view.extraGaps).toEqual({ [rendered[0]!.uid]: 0.2, [rendered[1]!.uid]: 0.4, [rendered[3]!.uid]: 0.6 });
  expect(barDimensions({ ...view, orientation: "column" }, { width: 80, height: 40 }).height).toBeCloseTo(308);
});

it("resolves both variable sources from current values for rendered buttons and shortcuts", async () => {
  const config = await loadConfig();
  config.userVariables = { "github.author": "user-owner", enabled: false };
  const template = "https://example.com/${user.github.author}/${external.github.author}?enabled=${user.enabled}";
  config.staticBookmarks = [{ uid: "definition", name: "Owner", url: template }];
  config.panel.menus = [{ uid: "menu", items: [{ uid: "button", type: "static", staticUid: "definition" }] }];
  await saveConfig(config);
  await saveExternalData("github.author", "external-owner");
  const entries = await resolveMenuItems(config.panel.menus[0]!.items, undefined, undefined, undefined, { staticBookmarks: config.staticBookmarks });
  await executeMenuAction(entries[0]!.uid, "menu", "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://example.com/user-owner/external-owner?enabled=false" });
  config.userVariables["github.author"] = "new-user";
  await saveConfig(config);
  await saveExternalData("github.author", "new-external");
  await executeMenuAction(invertNavigationActionUid(entries[0]!.uid), "menu", "42", () => {});
  expect(mocks.create).toHaveBeenLastCalledWith({ active: true, windowId: 42, url: "https://example.com/new-user/new-external?enabled=false" });
  await executeMenuAction("static:definition", undefined, "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://example.com/new-user/new-external?enabled=false" });
  expect((await loadConfig()).staticBookmarks[0]!.url).toBe(template);
});

it("stops navigation for missing variables, inherited names, and invalid references", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "definition", name: "Owner", url: "" }];
  for (const reference of ["${user.missing}", "${external.missing}", "${user.constructor}", "${other.key}", "${user.unclosed"]) {
    config.staticBookmarks[0]!.url = "https://example.com/" + reference;
    await saveConfig(config);
    await expect(executeMenuAction("static:definition", undefined, "42", () => {})).rejects.toThrow(reference);
  }
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("uses replacement values literally without expanding further references", async () => {
  const config = await loadConfig();
  config.userVariables = { value: "${external.secret}$&" };
  config.staticBookmarks = [{ uid: "definition", name: "Literal", url: "https://example.com/?q=${user.value}" }];
  await saveConfig(config);
  await executeMenuAction("static:definition", undefined, "42", () => {});
  expect(mocks.update).toHaveBeenLastCalledWith(17, { url: "https://example.com/?q=${external.secret}$&" });
});
