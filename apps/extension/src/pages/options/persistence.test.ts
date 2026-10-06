import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_MENU_COLOR, defaultBarSettings, defaultNativeBarSettings } from "@browserail/protocol";

const local = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(local.values[key])])),
      set: async (values: Record<string, unknown>) => { Object.assign(local.values, structuredClone(values)); },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  runtime: { sendMessage: async () => {} },
} }));
import { loadConfig, saveConfig, loadBarConfigurations, resolveBarConfiguration, saveBarLayout, defaultMenuPlacement, normalizeMenu } from "../../config";
import { createOptionsState, settingsFromConfig } from "./state";
import { createBookmarkLibrary } from "./bookmark-library";
import { createPersistence, loadOptions } from "./persistence";
import { loadExternalAuthorization } from "../../config/external-authorization-store";

beforeEach(() => { local.values = {}; });

it("removes legacy code bookmarks and their menu and shortcut references without converting them", async () => {
  const config = await loadConfig();
  const external = { uid: "external", name: "External", type: "external", urlRuleUid: "site" };
  local.values.config = {
    ...config,
    dynamicBookmarks: [external, { uid: "old", name: "Old", type: "code", code: "function dynamicBookmark() {}" }],
    panel: { menus: [{ uid: "bar", items: [
      { uid: "external-item", type: "dynamic", dynamicUid: "external" },
      { uid: "old-item", type: "dynamic", dynamicUid: "old" },
    ] }] },
    shortcuts: [{ slot: "slot_1", type: "dynamic", dynamicUid: "old" }],
    nativeShortcuts: [{ id: "old-key", key: "F1", type: "dynamic", dynamicUid: "old" }],
  };
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual([external]);
  expect(saved.panel.menus[0]!.items.map(item => item.uid)).toEqual(["external-item"]);
  expect(saved.shortcuts).toEqual([]);
  expect(saved.nativeShortcuts).toEqual([]);
});

it("saves external grants only with the instance and excludes them from portable settings", async () => {
  const { state, persistence } = await fixture();
  state.setExternalExtensionsEnabled(true);
  state.setExternalExtensionIds(" provider@example.com \nprovider@example.com\n");
  state.setUserscriptEnabled(true);
  const token = state.instance.externalAuthorization.token;
  expect((await loadExternalAuthorization()).userscriptEnabled).toBe(false);
  await persistence.saveSettings();
  expect((await loadExternalAuthorization()).extensionIds).toEqual([]);
  await persistence.saveInstance();
  expect(await loadExternalAuthorization()).toEqual({ extensionsEnabled: true, extensionIds: ["provider@example.com"], userscriptEnabled: true, token });
  const loaded = await loadOptions();
  expect(loaded.instance.externalAuthorization).toEqual(await loadExternalAuthorization());
  const exported = await persistence.exportSettings(true);
  expect(JSON.stringify(exported)).not.toContain(token);
  expect(JSON.stringify(exported)).not.toContain("provider@example.com");
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadExternalAuthorization()).token).toBe(token);
  persistence.destroy();
});
async function fixture() {
  const config = await loadConfig();
  config.instanceLabel = "Local instance";
  config.panel.menus = [{ uid: "bar", enabled: false, color: "#336699aa", dockColor: "#223344bb", items: [] }];
  config.staticBookmarks = [{ uid: "link", name: "Example", url: "https://example.com" }];
  config.shortcuts = [{ slot: "1", type: "static", staticUid: "link" }];
  await saveConfig(config);
  const state = createOptionsState({ label: config.instanceLabel, desktopUrl: config.desktopWidget.url, displayMode: "native", rootPrefix: [], syncEnabled: false, externalAuthorization: { extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token: "" } }, settingsFromConfig(config));
  const persistence = createPersistence(state, createBookmarkLibrary(() => []));
  return { state, persistence };
}
async function saveLayouts() {
  await saveBarLayout("bar", "native", { ...defaultMenuPlacement(), freePosition: { x: 300, y: 400 } }, { gapRatio: 0.2, extraGaps: { a: 0.4 } }, { ...defaultNativeBarSettings(), orientation: "row", attachmentMode: "free", onTopMode: "alwaysOnTop" });
  await saveBarLayout("bar", "browser", { ...defaultMenuPlacement(), boundPosition: { anchor: "bottomRight", offsetX: 40, offsetY: 50 } }, { gapRatio: 0.3, extraGaps: {} }, { ...defaultBarSettings(), expandDirection: "left", expandAlignment: "center", popupFontSize: 18 });
}

it("exports shared colors and bindings; optionally includes both modes without runtime or instance data", async () => {
  const { persistence } = await fixture(); await saveLayouts();
  const portable = await persistence.exportSettings();
  expect(portable.menus[0]).toMatchObject({ uid: "bar", color: "#336699aa", dockColor: "#223344bb" });
  expect(portable.shortcuts).toEqual([{ slot: "1", type: "static", staticUid: "link" }]);
  expect(portable.menus[0]).not.toHaveProperty("enabled");
  expect(portable).not.toHaveProperty("instanceLabel");
  expect(portable).not.toHaveProperty("barConfigurations");
  const complete = await persistence.exportSettings(true);
  expect(complete.barConfigurations).toEqual(await loadBarConfigurations());
  persistence.destroy();
});

it("preserves tag folder and flattened references through save and import even when the group is empty", async () => {
  const { state, persistence } = await fixture();
  const group = { uid: "group", type: "staticTag", staticTag: "work", color: "#123456ff", rename: "Work", expandOnHover: false };
  state.addMenuItem("bar", group);
  state.addMenuItem("bar", { ...group, uid: "flat", type: "flattenStaticTag" });
  await persistence.saveSettings();
  const exported = await persistence.exportSettings();
  expect(exported.menus[0]!.items).toEqual([group, { ...group, uid: "flat", type: "flattenStaticTag" }]);
  state.removeMenuItem("bar", "group");
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.items).toEqual([group, { ...group, uid: "flat", type: "flattenStaticTag" }]);
  persistence.destroy();
});

it("preserves static bookmark tags and order through save, reload, export and import", async () => {
  const { state, persistence } = await fixture();
  state.setStaticTags("link", [" work ", "reading", "work"]);
  state.addBookmark("static", { uid: "another", name: "Another", url: "https://another.example" });
  state.setStaticTags("another", ["reading"]);
  state.moveStaticBookmarkBefore("another", "link");
  await persistence.saveSettings();
  const expected = [
    { uid: "another", name: "Another", url: "https://another.example", tags: ["reading"] },
    { uid: "link", name: "Example", url: "https://example.com", tags: ["work", "reading"] },
  ];
  expect((await loadConfig()).staticBookmarks).toEqual(expected);
  const exported = await persistence.exportSettings();
  expect(exported.staticBookmarks).toEqual(expected);
  state.removeBookmark("static", "another");
  state.setStaticTags("link", []);
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadConfig()).staticBookmarks).toEqual(expected);
  persistence.destroy();
});

it("drops menu and item open modes on import and save while preserving shortcut choices", async () => {
  const { persistence } = await fixture();
  const data = await persistence.exportSettings();
  const shortcuts = [{ slot: "slot_1", type: "static", staticUid: "link", tabMode: "newTab" }];
  const nativeShortcuts = [{ id: "native-link", key: "Ctrl+A", type: "static", staticUid: "link", tabMode: "newTab" }];
  await persistence.importSettings(JSON.stringify({
    ...data,
    menus: [{ uid: "bar", tabMode: "newTab", items: [
      { uid: "static", type: "static", staticUid: "link", tabMode: "newTab" },
      { uid: "folder", type: "folder", path: ["Docs"], tabMode: "newTab" },
    ] }],
    shortcuts, nativeShortcuts,
  }));
  await persistence.saveSettings();
  const saved = await loadConfig();
  const portable = await persistence.exportSettings();
  for (const menu of [saved.panel.menus[0]!, portable.menus[0]!]) {
    expect(menu).not.toHaveProperty("tabMode");
    for (const item of menu.items) expect(item).not.toHaveProperty("tabMode");
  }
  expect(saved.shortcuts).toEqual(shortcuts);
  expect(saved.nativeShortcuts).toEqual(nativeShortcuts);
  expect(portable.shortcuts).toEqual(shortcuts);
  expect(portable.nativeShortcuts).toEqual(nativeShortcuts);
  persistence.destroy();
});

it("imports shared data without changing existing bar layouts, runtime enablement or the instance", async () => {
  const { state, persistence } = await fixture(); await saveLayouts();
  const before = await loadBarConfigurations();
  const data = await persistence.exportSettings(true);
  data.staticBookmarks![0]!.name = "Imported";
  await persistence.importSettings(JSON.stringify(data));
  await persistence.saveSettings();
  expect(await loadBarConfigurations()).toEqual(before);
  const config = await loadConfig();
  expect(config.panel.menus[0]!.enabled).toBe(false);
  expect(config.instanceLabel).toBe("Local instance");
  expect(config.staticBookmarks[0]!.name).toBe("Imported");
  expect(state.dirty.settings).toBe(false);
  persistence.destroy();
});

it("stages both modes until Save, then consumes the import so future saves preserve later bar edits", async () => {
  const { state, persistence } = await fixture(); await saveLayouts();
  const data = await persistence.exportSettings(true);
  const before = await loadBarConfigurations();
  data.barConfigurations!.browser.bar!.popupFontSize = 24;
  data.barConfigurations!.native.bar!.buttonFontSize = 21;
  data.barConfigurations!.browser.bar!.fontFamily = "Arial";
  data.barConfigurations!.native.bar!.fontFamily = "Microsoft YaHei";
  await persistence.importSettings(JSON.stringify(data), true);
  expect(await loadBarConfigurations()).toEqual(before);
  expect(state.dirty.settings).toBe(true);
  await persistence.saveSettings();
  expect((await loadBarConfigurations()).browser.bar!.popupFontSize).toBe(24);
  expect((await loadBarConfigurations()).native.bar!.buttonFontSize).toBe(21);
  expect((await loadBarConfigurations()).browser.bar!.fontFamily).toBe("Arial");
  expect((await loadBarConfigurations()).native.bar!.fontFamily).toBe("Microsoft YaHei");
  expect(state.settings.barConfigurations).toBeUndefined();
  const bars = await loadBarConfigurations();
  const browser = bars.browser.bar!;
  await saveBarLayout("bar", "browser", browser.placement, browser, { ...browser, popupFontSize: 30 });
  state.renameBookmark("static", "link", "Later edit");
  await persistence.saveSettings();
  expect((await loadBarConfigurations()).browser.bar!.popupFontSize).toBe(30);
  expect((await loadConfig()).panel.menus[0]!.enabled).toBe(false);
  persistence.destroy();
});

it("uses new defaults instead of migrating legacy bar appearance and positions", async () => {
  local.values.config = { panel: { menus: [{ uid: "bar", enabled: false, orientation: "row", buttonFontSize: 32, color: "#336699aa", gapRatio: 4, items: [] }] } };
  local.values.menu_placements = { bar: { boundPosition: { anchor: "bottomRight", offsetX: 300, offsetY: 400 } } };
  const config = await loadConfig();
  const bars = await loadBarConfigurations();
  expect(config.panel.menus[0]).toMatchObject({ color: "#336699aa", enabled: false });
  expect(resolveBarConfiguration(bars, "native", "bar")).toMatchObject(defaultNativeBarSettings());
  expect(resolveBarConfiguration(bars, "browser", "bar")).toMatchObject(defaultBarSettings());
});

it("fills the default color into stored menus that have none", () => {
  expect(normalizeMenu({ uid: "stored", items: [] })?.color).toBe(DEFAULT_MENU_COLOR);
  expect(normalizeMenu({ uid: "colored", color: "#123456ff", items: [] })?.color).toBe("#123456ff");
});


// The mocked polyfill has no `bookmarks`, like Firefox for Android.
it("opens settings in a browser without a bookmarks API and saves without touching stored browser bookmarks", async () => {
  const config = await loadConfig();
  const items = [
    { uid: "page", type: "bookmark", path: ["Bookmarks bar", "Docs"], url: "https://example.com" },
    { uid: "flat", type: "flattenFolder", path: ["Other bookmarks", "Daily"], includeFolders: true },
  ];
  config.panel.menus = [{ uid: "bar", enabled: true, color: DEFAULT_MENU_COLOR, items: structuredClone(items) }];
  config.shortcuts = [{ slot: "slot_1", type: "bookmark", path: ["Bookmarks bar", "Docs"], url: "https://example.com" }];
  await saveConfig(config);
  const loaded = await loadOptions();
  expect(loaded.bookmarksAvailable).toBe(false);
  const state = createOptionsState(loaded.instance, loaded.settings);
  const library = createBookmarkLibrary(() => state.instance.rootPrefix);
  library.initialize(loaded.tree, loaded.bookmarksAvailable);
  const persistence = createPersistence(state, library);
  state.addBookmark("static", { uid: "new", name: "New", url: "https://example.org" });
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.panel.menus[0]!.items).toEqual(items);
  expect(saved.shortcuts).toEqual(config.shortcuts);
  expect(saved.staticBookmarks.map(entry => entry.uid)).toContain("new");
  persistence.destroy();
});

it("does not let an imported dynamic bookmark borrow a local URL rule that only shares its uid", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "docs", name: "Local", patterns: ["*"] });
  const script = { uid: "external", name: "External", type: "external", urlRuleUid: "docs" };
  const withoutRules = { version: 2, exportedAt: "2026-10-04T00:00:00.000Z", menus: [], dynamicBookmarks: [script] };
  await persistence.importSettings(JSON.stringify(withoutRules), false, true);
  expect(state.settings.dynamicBookmarks[0]).not.toHaveProperty("urlRuleUid");
  const withRules = { ...withoutRules, urlRules: [{ uid: "docs", name: "Docs", patterns: ["example.com"] }] };
  await persistence.importSettings(JSON.stringify(withRules), false, true);
  expect(state.settings.dynamicBookmarks[0]!.urlRuleUid).toBe("docs");
  persistence.destroy();
});

it("round-trips rule and external definitions with commented exclusion rules", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "docs", name: "Docs", patterns: ["# context", "example.com", "# excluded", "!https://example.com/private"] });
  state.addBookmark("dynamic", { uid: "rule", name: "Rule", type: "rule", urlRuleUid: "docs" });
  state.addBookmark("dynamic", { uid: "external", name: "External", type: "external", urlRuleUid: "docs" });
  const exported = await persistence.exportSettings();
  await persistence.importSettings(JSON.stringify(exported), false, true);
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual(exported.dynamicBookmarks);
  expect(saved.urlRules).toEqual(exported.urlRules);
  persistence.destroy();
});

it.each([false, true])("imports external definitions normally and rewrites only with explicit consent (%s)", async (includeRewrites) => {
  const { state, persistence } = await fixture();
  const data = await persistence.exportSettings();
  data.urlRules = [{ uid: "docs", name: "Docs", patterns: ["example.com"] }];
  const rule = { uid: "rule", name: "Rule", type: "rule" as const, urlRuleUid: "docs" };
  const script = { uid: "script", name: "Script", type: "external" as const, urlRuleUid: "docs" };
  const rewrite = { uid: "rewrite", name: "Rewrite", type: "rewrite" as const, rewrite: 'replace "/article/" "/reader/"', urlRuleUid: "docs" };
  data.dynamicBookmarks = [rule, script, rewrite];
  data.menus[0]!.items = [
    { uid: "rule-item", type: "dynamic", dynamicUid: rule.uid },
    { uid: "script-item", type: "dynamic", dynamicUid: script.uid },
    { uid: "static-item", type: "static", staticUid: "link" },
    { uid: "rewrite-item", type: "dynamic", dynamicUid: rewrite.uid },
  ];
  data.shortcuts = [
    { slot: "slot_1", type: "dynamic", dynamicUid: rule.uid },
    { slot: "slot_2", type: "dynamic", dynamicUid: script.uid },
    { slot: "slot_3", type: "static", staticUid: "link" },
    { slot: "slot_4", type: "dynamic", dynamicUid: rewrite.uid },
  ];
  data.nativeShortcuts = [
    { id: "rule-key", key: "F1", type: "dynamic", dynamicUid: rule.uid },
    { id: "script-key", key: "F2", type: "dynamic", dynamicUid: script.uid },
    { id: "static-key", key: "F3", type: "static", staticUid: "link" },
    { id: "rewrite-key", key: "F4", type: "dynamic", dynamicUid: rewrite.uid },
  ];
  if (includeRewrites) await persistence.importSettings(JSON.stringify(data), false, true);
  else await persistence.importSettings(JSON.stringify(data));
  expect(state.settings.dynamicBookmarks).toEqual(includeRewrites ? [rule, script, rewrite] : [rule, script]);
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual(includeRewrites ? [rule, script, rewrite] : [rule, script]);
  expect(saved.panel.menus[0]!.items.map(item => item.uid)).toEqual(includeRewrites ? ["rule-item", "script-item", "static-item", "rewrite-item"] : ["rule-item", "script-item", "static-item"]);
  expect(saved.shortcuts.map(shortcut => shortcut.slot)).toEqual(includeRewrites ? ["slot_1", "slot_2", "slot_3", "slot_4"] : ["slot_1", "slot_2", "slot_3"]);
  expect(saved.nativeShortcuts.map(shortcut => shortcut.id)).toEqual(includeRewrites ? ["rule-key", "script-key", "static-key", "rewrite-key"] : ["rule-key", "script-key", "static-key"]);
  persistence.destroy();
});

it("saves and exports user variables without exporting or overwriting external KV", async () => {
  const { state, persistence } = await fixture();
  local.values["external_data:shared"] = "External value";
  const variables = { shared: "User value", settings: { enabled: true }, list: [1, null] };
  const template = "https://example.com/${user.shared}/${external.shared}";
  state.setStaticUrl("link", template);
  for (const [key, value] of Object.entries(variables)) state.editUserVariable(state.addUserVariable(), { key, value });
  await persistence.saveSettings();
  expect((await loadConfig()).userVariables).toEqual(variables);
  expect(state.dirty.settings).toBe(false);
  const exported = await persistence.exportSettings();
  expect(exported.userVariables).toEqual(variables);
  expect(exported.staticBookmarks![0]!.url).toBe(template);
  expect(JSON.stringify(exported)).not.toContain("External value");
  for (const row of state.userVariables) state.removeUserVariable(row.uid);
  await persistence.importSettings(JSON.stringify(exported));
  expect(state.settings.userVariables).toEqual(variables);
  await persistence.saveSettings();
  expect(local.values["external_data:shared"]).toBe("External value");
  expect((await loadConfig()).staticBookmarks[0]!.url).toBe(template);
  persistence.destroy();
});

it("rejects empty or duplicate keys without saving over existing variables", async () => {
  const { state, persistence } = await fixture();
  const uid = state.addUserVariable();
  state.editUserVariable(uid, { key: "name", value: "saved" });
  await persistence.saveSettings();
  for (const key of ["", " "]) {
    state.editUserVariable(uid, { key });
    await expect(persistence.saveSettings()).rejects.toThrow();
    await expect(persistence.exportSettings()).rejects.toThrow();
    expect(state.dirty.settings).toBe(true);
    expect((await loadConfig()).userVariables).toEqual({ name: "saved" });
  }
  state.editUserVariable(uid, { key: "name" });
  const duplicate = state.addUserVariable();
  state.editUserVariable(duplicate, { key: "name", value: "other" });
  await expect(persistence.saveSettings()).rejects.toThrow();
  expect((await loadConfig()).userVariables).toEqual({ name: "saved" });
  state.removeUserVariable(duplicate);
  state.editUserVariable(uid, { key: "renamed" });
  await persistence.saveSettings();
  expect((await loadConfig()).userVariables).toEqual({ renamed: "saved" });
  state.removeUserVariable(uid);
  await persistence.saveSettings();
  expect((await loadConfig()).userVariables).toEqual({});
  expect(state.dirty.settings).toBe(false);
  persistence.destroy();
});
