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
import { loadConfig, saveConfig, loadBarConfigurations, resolveBarConfiguration, saveBarLayout, defaultMenuPlacement, normalizeMenu, saveShortcutsEnabled, loadShortcutsEnabled, type StoredMenuItem } from "../../config";
import { createOptionsState, settingsFromConfig } from "./state";
import { createBookmarkLibrary } from "./bookmark-library";
import { createPersistence, loadOptions } from "./persistence";
import { loadExternalAuthorization } from "../../config/external-authorization-store";

beforeEach(() => { local.values = {}; });

it("discards old flat Native bindings without changing browser shortcuts or other settings", async () => {
  const config = await loadConfig();
  config.shortcuts = [{ slot: "slot_1", type: "browserAction", browserAction: "back" }];
  local.values.config = { ...config, nativeShortcuts: [{ id: "old", key: "c", type: "browserAction", browserAction: "back" }] };
  const saved = await loadConfig();
  expect(saved.nativeShortcutSets).toEqual([]);
  expect(saved.shortcuts).toEqual(config.shortcuts);
  await saveConfig(saved);
  expect(local.values.config).not.toHaveProperty("nativeShortcuts");
});

it("merges imported Native sets by UID while retaining other groups, URL scope and targets", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "site", name: "Site", patterns: ["example.com"] });
  state.addNativeShortcutSet({ uid: "local", name: "Local", shortcuts: [{ id: "local-key", key: "F1", type: "browserAction", browserAction: "back" }] });
  state.addNativeShortcutSet({ uid: "shared", name: "Old", shortcuts: [{ id: "old", key: "F2", type: "browserAction", browserAction: "back" }] });
  const data = { version: 2, exportedAt: "2026-10-09T00:00:00.000Z", nativeShortcutSets: [
    { uid: "shared", name: "New", urlRuleUids: ["site"], shortcuts: [{ id: "new", key: "F3", type: "browserAction", browserAction: "reload" }] },
  ] };
  await persistence.importSettings(JSON.stringify(data));
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.nativeShortcutSets[0]).toEqual(data.nativeShortcutSets[0]);
  expect(saved.nativeShortcutSets[1]!.uid).toBe("local");
  expect((await persistence.exportSettings()).nativeShortcutSets).toEqual(saved.nativeShortcutSets);
  expect((await persistence.exportSettings({ shortcuts: false })).nativeShortcutSets).toBeUndefined();
  persistence.destroy();
});

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
  expect(saved.nativeShortcutSets).toEqual([]);
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
  const exported = await persistence.exportSettings({ bars: true });
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
  config.panel.menus = [{ uid: "bar", enabled: false, style: "tiles", color: "#336699aa", dockColor: "#223344bb", items: [] }];
  config.staticBookmarks = [{ uid: "link", name: "Example", url: "https://example.com" }];
  config.shortcuts = [{ slot: "1", type: "static", staticUid: "link" }];
  await saveConfig(config);
  const state = createOptionsState({ label: config.instanceLabel, desktopUrl: config.desktopWidget.url, displayMode: "native", rootPrefix: [], externalAuthorization: { extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token: "" } }, settingsFromConfig(config));
  const persistence = createPersistence(state, createBookmarkLibrary(() => []));
  return { state, persistence };
}
async function saveLayouts() {
  await saveBarLayout("bar", "native", { ...defaultMenuPlacement(), freePosition: { x: 300, y: 400 } }, { gapRatio: 0.2, extraGaps: { a: 0.4 } }, { ...defaultNativeBarSettings(), orientation: "row", attachmentMode: "free", onTopMode: "alwaysOnTop", autoHideRange: { start: .1, end: .3 } });
  await saveBarLayout("bar", "browser", { ...defaultMenuPlacement(), boundPosition: { anchor: "bottomRight", offsetX: 40, offsetY: 50 } }, { gapRatio: 0.3, extraGaps: {} }, { ...defaultBarSettings(), expandDirection: "left", expandAlignment: "center", popupFontSize: 18, autoHideRange: { start: .7, end: 1 } });
}

it("preserves CSS classes and icons for every item type through save and portable import, and clears an empty class", async () => {
  const { state, persistence } = await fixture();
  state.addBookmark("temporary", { uid: "later", name: "Later" });
  state.addBookmark("dynamic", { uid: "live", name: "Live", type: "external" });
  const sources: Array<Omit<StoredMenuItem, "uid">> = [
    { type: "bookmark", path: ["Docs"] }, { type: "folder", path: ["Folder"] },
    { type: "flattenFolder", path: ["Folder"] }, { type: "static", staticUid: "link" },
    { type: "temporary", temporaryUid: "later" }, { type: "dynamic", dynamicUid: "live" },
    { type: "staticTag", staticTag: "work" }, { type: "flattenStaticTag", staticTag: "work" },
    { type: "menuFold" }, { type: "menusToggle", targetMenuUids: [] },
    { type: "browserAction", browserAction: "reload" }, { type: "shortcutsToggle" }, { type: "autoHideToggle" },
  ];
  const icons = [{ type: "lucide", name: "bookmark" }, { type: "text", text: "你好" }, { type: "initial" }, { type: "initial", length: 2 }] as const;
  for (const [index, source] of sources.entries()) {
    state.addMenuItem("bar", { uid: source.type!, ...source });
    state.setItemCssClass("bar", source.type!, " icon-home compact ");
    state.setItemIcon("bar", source.type!, icons[index % icons.length]!);
  }
  await persistence.saveSettings();
  const exported = await persistence.exportSettings();
  expect(exported.menus![0]!.items.map(item => item.cssClass)).toEqual(sources.map(() => "icon-home compact"));
  const expectedIcons = sources.map((_, index) => icons[index % icons.length]);
  expect(exported.menus![0]!.items.map(item => item.icon)).toEqual(expectedIcons);
  state.removeMenuItem("bar", "bookmark");
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.items.map(item => item.cssClass)).toEqual(sources.map(() => "icon-home compact"));
  expect((await loadConfig()).panel.menus[0]!.items.map(item => item.icon)).toEqual(expectedIcons);
  state.setItemIcon("bar", "bookmark", undefined);
  state.setItemCssClass("bar", "bookmark", " ");
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.items[0]).not.toHaveProperty("cssClass");
  expect((await loadConfig()).panel.menus[0]!.items[0]).not.toHaveProperty("icon");
  persistence.destroy();
});

it("exports shared colors and bindings; optionally includes both modes without runtime or instance data", async () => {
  const { persistence } = await fixture(); await saveLayouts();
  const portable = await persistence.exportSettings();
  expect(portable.menus![0]).toMatchObject({ uid: "bar", color: "#336699aa", dockColor: "#223344bb" });
  expect(portable.shortcuts).toEqual([{ slot: "1", type: "static", staticUid: "link" }]);
  expect(portable.menus![0]).not.toHaveProperty("enabled");
  expect(portable).not.toHaveProperty("instanceLabel");
  expect(portable).not.toHaveProperty("barConfigurations");
  const complete = await persistence.exportSettings({ bars: true });
  expect(complete.barConfigurations).toEqual(await loadBarConfigurations());
  expect(portable.menus![0]!.style).toBe("tiles");
  expect(complete.barConfigurations!.native.bar).not.toHaveProperty("style");
  expect(complete.barConfigurations!.browser.bar).not.toHaveProperty("style");
  expect(complete.barConfigurations!.native.bar!.autoHideRange).toEqual({ start: .1, end: .3 });
  expect(complete.barConfigurations!.browser.bar!.autoHideRange).toEqual({ start: .7, end: 1 });
  persistence.destroy();
});

it("preserves tag folder and flattened references through save and import even when the group is empty", async () => {
  const { state, persistence } = await fixture();
  const group = { uid: "group", type: "staticTag", staticTag: "work", color: "#123456ff", rename: "Work", expandOnHover: false };
  state.addMenuItem("bar", group);
  state.addMenuItem("bar", { ...group, uid: "flat", type: "flattenStaticTag" });
  await persistence.saveSettings();
  const exported = await persistence.exportSettings();
  expect(exported.menus![0]!.items).toEqual([group, { ...group, uid: "flat", type: "flattenStaticTag" }]);
  state.removeMenuItem("bar", "group");
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.items).toEqual([group, { ...group, uid: "flat", type: "flattenStaticTag" }]);
  persistence.destroy();
});

it("exports the shortcut toggle definition without the instance switch and preserves that switch on import", async () => {
  const { state, persistence } = await fixture();
  const action = { uid: "keys", type: "shortcutsToggle", rename: "Keys {on}", color: "#123456ff" };
  state.addMenuItem("bar", action);
  await persistence.saveSettings();
  const enabledExport = await persistence.exportSettings();
  await saveShortcutsEnabled(false);
  const disabledExport = await persistence.exportSettings();
  expect({ ...disabledExport, exportedAt: enabledExport.exportedAt }).toEqual(enabledExport);
  expect(disabledExport.menus![0]!.items).toEqual([action]);
  state.removeMenuItem("bar", "keys");
  await persistence.importSettings(JSON.stringify(disabledExport));
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.items).toEqual([action]);
  expect(await loadShortcutsEnabled()).toBe(false);
  persistence.destroy();
});

it("saves and imports independent shortcut actions without a bar action button", async () => {
  const { state, persistence } = await fixture();
  state.removeShortcut({ kind: "slot", slot: "1" });
  state.setShortcutTarget({ kind: "slot", slot: "slot_1" }, { type: "menuFold", menuUid: "bar" });
  state.setShortcutTarget({ kind: "slot", slot: "slot_2" }, { type: "menusToggle", targetMenuUids: ["bar"] });
  state.setShortcutTarget({ kind: "slot", slot: "slot_3" }, { type: "shortcutsToggle" });
  state.setShortcutTarget({ kind: "slot", slot: "slot_4" }, { type: "autoHideToggle", menuUid: "bar" });
  state.addNativeShortcutSet({ uid: "keys", name: "Keys", shortcuts: [] });
  state.addNativeShortcut("keys", { id: "reload", key: "F1" });
  state.setShortcutTarget({ kind: "native", id: "reload" }, { type: "browserAction", browserAction: "reload" });
  await persistence.saveSettings();
  const saved = await loadConfig();
  const file = await persistence.exportSettings();
  expect(file.shortcuts).toEqual(saved.shortcuts);
  expect(file.nativeShortcutSets).toEqual(saved.nativeShortcutSets);
  await persistence.importSettings(JSON.stringify(file));
  await persistence.saveSettings();
  expect((await loadConfig()).shortcuts).toEqual(saved.shortcuts);
  expect((await loadConfig()).nativeShortcutSets).toEqual(saved.nativeShortcutSets);
  expect((await loadConfig()).panel.menus[0]!.items).toEqual([]);
  persistence.destroy();
});

it("preserves static bookmark tags and order through save, reload, export and import", async () => {
  const { state, persistence } = await fixture();
  state.setStaticTags("link", [" work ", "reading", "work"]);
  state.addBookmark("static", { uid: "another", name: "Another", url: "https://another.example" });
  state.setStaticTags("another", ["reading"]);
  state.moveStaticBookmark("another", "link", "before");
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
  const { state, persistence } = await fixture();
  state.removeShortcut({ kind: "slot", slot: "1" });
  const data = await persistence.exportSettings();
  const shortcuts = [{ slot: "slot_1", type: "static", staticUid: "link", tabMode: "newTab" }];
  const nativeShortcutSets = [{ uid: "keys", name: "Keys", shortcuts: [{ id: "native-link", key: "Ctrl+A", type: "static", staticUid: "link", tabMode: "newTab" }] }];
  await persistence.importSettings(JSON.stringify({
    ...data,
    menus: [{ uid: "bar", tabMode: "newTab", items: [
      { uid: "static", type: "static", staticUid: "link", tabMode: "newTab" },
      { uid: "folder", type: "folder", path: ["Docs"], tabMode: "newTab" },
    ] }],
    shortcuts, nativeShortcutSets,
  }));
  await persistence.saveSettings();
  const saved = await loadConfig();
  const portable = await persistence.exportSettings();
  for (const menu of [saved.panel.menus[0]!, portable.menus![0]!]) {
    expect(menu).not.toHaveProperty("tabMode");
    for (const item of menu.items) expect(item).not.toHaveProperty("tabMode");
  }
  expect(saved.shortcuts).toEqual(shortcuts);
  expect(saved.nativeShortcutSets).toEqual(nativeShortcutSets);
  expect(portable.shortcuts).toEqual(shortcuts);
  expect(portable.nativeShortcutSets).toEqual(nativeShortcutSets);
  persistence.destroy();
});

it("imports shared data without changing existing bar layouts, runtime enablement or the instance", async () => {
  const { state, persistence } = await fixture(); await saveLayouts();
  const before = await loadBarConfigurations();
  const data = await persistence.exportSettings({ bars: true });
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
  const data = await persistence.exportSettings({ bars: true });
  const before = await loadBarConfigurations();
  data.barConfigurations!.browser.bar!.popupFontSize = 24;
  data.barConfigurations!.native.bar!.buttonFontSize = 21;
  data.barConfigurations!.browser.bar!.fontFamily = "Arial";
  data.barConfigurations!.native.bar!.fontFamily = "Microsoft YaHei";
  await persistence.importSettings(JSON.stringify(data), { bars: true });
  expect(await loadBarConfigurations()).toEqual(before);
  expect(state.dirty.settings).toBe(true);
  await persistence.saveSettings();
  expect((await loadBarConfigurations()).browser.bar!.popupFontSize).toBe(24);
  expect((await loadBarConfigurations()).native.bar!.buttonFontSize).toBe(21);
  expect((await loadBarConfigurations()).browser.bar!.fontFamily).toBe("Arial");
  expect((await loadBarConfigurations()).native.bar!.fontFamily).toBe("Microsoft YaHei");
  expect((await loadBarConfigurations()).native.bar!.autoHideRange).toEqual({ start: .1, end: .3 });
  expect((await loadBarConfigurations()).browser.bar!.autoHideRange).toEqual({ start: .7, end: 1 });
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
  await persistence.importSettings(JSON.stringify(withoutRules), { includeRewrites: true });
  expect(state.settings.dynamicBookmarks[0]).not.toHaveProperty("urlRuleUid");
  const withRules = { ...withoutRules, urlRules: [{ uid: "docs", name: "Docs", patterns: ["example.com"] }] };
  await persistence.importSettings(JSON.stringify(withRules), { includeRewrites: true });
  expect(state.settings.dynamicBookmarks[0]!.urlRuleUid).toBe("docs");
  persistence.destroy();
});

it("round-trips rule and external definitions with commented exclusion rules", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "docs", name: "Docs", patterns: ["# context", "example.com", "# excluded", "!https://example.com/private"] });
  state.addBookmark("dynamic", { uid: "rule", name: "Rule", type: "rule", urlRuleUid: "docs" });
  state.addBookmark("dynamic", { uid: "external", name: "External", type: "external", urlRuleUid: "docs" });
  const exported = await persistence.exportSettings();
  await persistence.importSettings(JSON.stringify(exported), { includeRewrites: true });
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
  data.menus![0]!.items = [
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
  data.nativeShortcutSets = [{ uid: "keys", name: "Keys", shortcuts: [
    { id: "rule-key", key: "F1", type: "dynamic", dynamicUid: rule.uid },
    { id: "script-key", key: "F2", type: "dynamic", dynamicUid: script.uid },
    { id: "static-key", key: "F3", type: "static", staticUid: "link" },
    { id: "rewrite-key", key: "F4", type: "dynamic", dynamicUid: rewrite.uid },
  ] }];
  if (includeRewrites) await persistence.importSettings(JSON.stringify(data), { includeRewrites: true });
  else await persistence.importSettings(JSON.stringify(data));
  expect(state.settings.dynamicBookmarks).toEqual(includeRewrites ? [rule, script, rewrite] : [rule, script]);
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual(includeRewrites ? [rule, script, rewrite] : [rule, script]);
  expect(saved.panel.menus[0]!.items.map(item => item.uid)).toEqual(includeRewrites ? ["rule-item", "script-item", "static-item", "rewrite-item"] : ["rule-item", "script-item", "static-item"]);
  expect(saved.shortcuts.map(shortcut => shortcut.slot)).toEqual(includeRewrites ? ["slot_1", "slot_2", "slot_3", "slot_4"] : ["slot_1", "slot_2", "slot_3"]);
  expect(saved.nativeShortcutSets.flatMap(set => set.shortcuts).map(shortcut => shortcut.id)).toEqual(includeRewrites ? ["rule-key", "script-key", "static-key", "rewrite-key"] : ["rule-key", "script-key", "static-key"]);
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

it("saves and exports shared CSS without bar layouts, stages imports, and removes cleared CSS", async () => {
  const { state, persistence } = await fixture();
  const globalCss = { icons: "& { --icon: \"★\"; }" };
  const cssClass = "icon-bar compact";
  state.setMenuStyle("bar", "icons");
  state.addGlobalCss("icons");
  state.setGlobalCss("icons", globalCss.icons); state.setMenuCssClass("bar", cssClass);
  expect((await loadConfig()).globalCss).toBeUndefined();
  await persistence.saveSettings();
  expect((await loadConfig()).globalCss).toEqual(globalCss);
  expect((await loadConfig()).panel.menus[0]!.cssClass).toBe(cssClass);
  const exported = await persistence.exportSettings();
  expect(exported).toMatchObject({ globalCss, menus: [{ uid: "bar", cssClass, style: "icons" }] });
  expect(exported.barConfigurations).toBeUndefined();
  state.setMenuStyle("bar", "text");
  state.removeGlobalCss("icons"); state.setMenuCssClass("bar", "");
  await persistence.saveSettings();
  expect((await loadConfig()).globalCss).toBeUndefined();
  expect((await loadConfig()).panel.menus[0]!.style).toBeUndefined();
  expect((await loadConfig()).panel.menus[0]!.cssClass).toBeUndefined();
  await persistence.importSettings(JSON.stringify(exported));
  expect(state.settings).toMatchObject({ globalCss, menus: [{ uid: "bar", cssClass, style: "icons" }] });
  expect((await loadConfig()).globalCss).toBeUndefined();
  await persistence.saveSettings();
  expect((await loadConfig()).panel.menus[0]!.cssClass).toBe(cssClass);
  delete exported.globalCss; delete exported.menus![0]!.cssClass;
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  expect((await loadConfig()).globalCss).toEqual(globalCss);
  expect((await loadConfig()).panel.menus[0]!.cssClass).toBeUndefined();
  persistence.destroy();
});

it("merges global CSS by key on import, replaces matching keys and preserves absent keys", async () => {
  const { state, persistence } = await fixture();
  state.addGlobalCss("local");
  state.setGlobalCss("local", ".menu-button { color: red; }");
  state.addGlobalCss("shared");
  state.setGlobalCss("shared", "& { --bar-shadow: none; }");
  await persistence.saveSettings();
  const exported = await persistence.exportSettings();
  exported.globalCss = { shared: "& { --bar-border: 0; }", icons: "& { --icon: none; }" };
  await persistence.importSettings(JSON.stringify(exported));
  const expected = { local: ".menu-button { color: red; }", ...exported.globalCss };
  expect(state.settings.globalCss).toEqual(expected);
  expect((await loadConfig()).globalCss).not.toEqual(expected);
  await persistence.saveSettings();
  expect((await loadConfig()).globalCss).toEqual(expected);
  exported.globalCss = { shared: "" };
  await persistence.importSettings(JSON.stringify(exported));
  expect(state.settings.globalCss).toEqual({ ...expected, shared: "" });
  delete exported.globalCss;
  await persistence.importSettings(JSON.stringify(exported));
  expect(state.settings.globalCss).toEqual({ ...expected, shared: "" });
  persistence.destroy();
});


it("imports matching record keys and retains local-only menus, rules, bookmarks, variables and shortcuts", async () => {
  const { state, persistence } = await fixture();
  state.addMenu({ uid: "local-bar", name: "Local bar", items: [] });
  state.addUrlRule({ uid: "site", name: "Old site", patterns: ["old.example"] });
  state.addUrlRule({ uid: "local-site", name: "Local site", patterns: ["local.example"] });
  state.addGlobalCss("local");
  state.setGlobalCss("local", ".local {}");
  state.addGlobalCss("shared");
  state.setGlobalCss("shared", ".old {}");
  state.addBookmark("static", { uid: "local-link", name: "Local link", url: "https://local.example" });
  state.addBookmark("temporary", { uid: "local-temp", name: "Local temporary" });
  state.addBookmark("dynamic", { uid: "local-dynamic", name: "Local dynamic", type: "external" });
  state.addNativeShortcutSet({ uid: "local-set", name: "Local", shortcuts: [{ id: "local-key", key: "F1", type: "browserAction", browserAction: "back" }] });
  const variable = state.addUserVariable();
  state.editUserVariable(variable, { key: "local", value: "keep" });
  const sharedVariable = state.addUserVariable();
  state.editUserVariable(sharedVariable, { key: "shared", value: "old" });
  const local = structuredClone(state.settings);
  const file = {
    version: 2, exportedAt: "2026-10-09T00:00:00.000Z",
    menus: [{ uid: "bar", name: "Imported", items: [] }, { uid: "new-bar", items: [] }],
    urlRules: [{ uid: "site", name: "New site", patterns: ["example.com"] }],
    staticBookmarks: [{ uid: "link", name: "Imported link", url: "https://example.org" }],
    temporaryBookmarks: [{ uid: "new-temp", name: "New temporary" }],
    dynamicBookmarks: [{ uid: "new-dynamic", name: "New dynamic", type: "external", urlRuleUid: "site" }],
    shortcuts: [{ slot: "1", type: "browserAction", browserAction: "reload" }],
    nativeShortcutSets: [{ uid: "local-set", name: "Imported", shortcuts: [{ id: "local-key", key: "F2", type: "browserAction", browserAction: "forward" }] }],
    userVariables: { shared: "new", added: "new" },
    globalCss: { shared: ".new {}" },
  };
  await persistence.importSettings(JSON.stringify(file));
  expect(state.settings.menus.map(menu => menu.uid)).toEqual(["bar", "new-bar", "local-bar"]);
  expect(state.settings.menus.find(menu => menu.uid === "bar")?.name).toBe("Imported");
  expect(state.settings.menus.find(menu => menu.uid === "local-bar")).toEqual(local.menus[1]);
  expect(state.settings.urlRules).toEqual([file.urlRules[0], local.urlRules[1]]);
  expect(state.settings.staticBookmarks).toEqual([file.staticBookmarks[0], local.staticBookmarks[1]]);
  expect(state.settings.temporaryBookmarks).toEqual([...file.temporaryBookmarks, ...local.temporaryBookmarks]);
  expect(state.settings.dynamicBookmarks).toEqual([...file.dynamicBookmarks, ...local.dynamicBookmarks]);
  expect(state.settings.shortcuts).toEqual(file.shortcuts);
  expect(state.settings.nativeShortcutSets).toEqual(file.nativeShortcutSets);
  expect(state.settings.userVariables).toEqual({ local: "keep", shared: "new", added: "new" });
  expect(state.settings.globalCss).toEqual({ local: ".local {}", shared: ".new {}" });
  await persistence.importSettings(JSON.stringify({ ...file, menus: [], urlRules: [], staticBookmarks: [], temporaryBookmarks: [], dynamicBookmarks: [], shortcuts: [], nativeShortcutSets: [], userVariables: {}, globalCss: {} }));
  expect(state.settings.menus).toHaveLength(3);
  expect(state.settings.staticBookmarks).toHaveLength(2);
  expect(state.settings.userVariables).toEqual({ local: "keep", shared: "new", added: "new" });
  persistence.destroy();
});

it.each(["merge", "replace"] as const)("leaves unselected drafts and invalid variable rows intact during %s imports", async mode => {
  const { state, persistence } = await fixture();
  state.addGlobalCss("theme");
  state.setGlobalCss("theme", ".theme {}");
  state.addUrlRule({ uid: "local-site", name: "Local site", patterns: ["local.example"] });
  const variable = state.addUserVariable();
  state.editUserVariable(variable, { key: "local", value: "keep" });
  const onlyBookmarks = { menus: false, urlRules: false, bookmarks: true, shortcuts: false, bars: false };
  const file = await persistence.exportSettings(onlyBookmarks);
  expect(Object.keys(file).sort()).toEqual(["version", "exportedAt", "staticBookmarks", "dynamicBookmarks", "temporaryBookmarks", "externalActions", "userVariables"].sort());
  const before = structuredClone(state.settings);
  const invalid = state.addUserVariable();
  const variableRows = structuredClone(state.userVariables);
  await persistence.importSettings(JSON.stringify({ version: 2, exportedAt: file.exportedAt, menus: [{ uid: "bar", name: "Ignored", items: [] }], urlRules: [{ uid: "imported-site", name: "Imported", patterns: ["example.com"] }], staticBookmarks: [], shortcuts: [], userVariables: { local: "overwrite" } }), { menus: false, bookmarks: false, shortcuts: false, mode });
  expect(state.settings.menus).toEqual(before.menus);
  expect(state.settings.globalCss).toEqual(before.globalCss);
  expect(state.settings.staticBookmarks).toEqual(before.staticBookmarks);
  expect(state.settings.shortcuts).toEqual(before.shortcuts);
  expect(state.settings.userVariables).toEqual(before.userVariables);
  expect(state.userVariables).toEqual(variableRows);
  expect(state.userVariablesValid).toBe(false);
  expect(state.settings.urlRules.map(rule => rule.uid)).toEqual(mode === "replace" ? ["imported-site"] : ["imported-site", "local-site"]);
  state.removeUserVariable(invalid);
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.staticBookmarks).toEqual(before.staticBookmarks);
  expect(saved.panel.menus).toEqual(before.menus);
  persistence.destroy();
});

it("replaces available categories, clearing their associated CSS, variables and omitted collections", async () => {
  const { state, persistence } = await fixture();
  state.addMenu({ uid: "local-bar", items: [] });
  state.addGlobalCss("local"); state.setGlobalCss("local", ".local {}");
  state.addUrlRule({ uid: "old-rule", name: "Old", patterns: ["example.com"] });
  state.setDefaultRule("old-rule");
  state.addBookmark("temporary", { uid: "old-temp", name: "Old" });
  state.addBookmark("dynamic", { uid: "old-dynamic", name: "Old", type: "external", urlRuleUid: "old-rule" });
  state.addNativeShortcutSet({ uid: "old-keys", name: "Old", shortcuts: [{ id: "key", key: "F1", type: "browserAction", browserAction: "back" }] });
  const variable = state.addUserVariable(); state.editUserVariable(variable, { key: "old", value: "value" });
  await saveLayouts();
  const layouts = await loadBarConfigurations();
  const file = { version: 2, exportedAt: "2026-10-09T00:00:00Z", menus: [{ uid: "bar", name: "Imported", items: [] }], urlRules: [], staticBookmarks: [{ uid: "new-link", name: "New", url: "https://example.org" }], shortcuts: [] };
  await persistence.importSettings(JSON.stringify(file), { mode: "replace" });
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.panel.menus.map(menu => menu.uid)).toEqual(["bar"]);
  expect(saved.panel.menus[0]).toMatchObject({ name: "Imported", enabled: false });
  expect(saved.globalCss).toBeUndefined();
  expect(saved.urlRules).toEqual([]);
  expect(saved.defaultUrlRuleUid).toBeUndefined();
  expect(saved.staticBookmarks).toEqual(file.staticBookmarks);
  expect(saved.dynamicBookmarks).toEqual([]);
  expect(saved.temporaryBookmarks).toEqual([]);
  expect(saved.externalActions).toEqual([]);
  expect(saved.userVariables).toEqual({});
  expect(saved.shortcuts).toEqual([]);
  expect(saved.nativeShortcutSets).toEqual([]);
  expect(saved.instanceLabel).toBe("Local instance");
  expect(await loadBarConfigurations()).toEqual(layouts);
  expect(state.dirty.settings).toBe(false);
  persistence.destroy();
});

it("clears an empty selected bookmark category without clearing absent menu, rule or shortcut categories", async () => {
  const { state, persistence } = await fixture();
  state.removeShortcut({ kind: "slot", slot: "1" });
  state.setShortcutTarget({ kind: "slot", slot: "slot_1" }, { type: "static", uid: "link" });
  state.addUrlRule({ uid: "site", name: "Site", patterns: ["example.com"] });
  state.setDefaultRule("site");
  state.addUserVariable();
  expect(state.userVariablesValid).toBe(false);
  const before = structuredClone(state.settings);
  await persistence.importSettings(JSON.stringify({ version: 2, exportedAt: "2026-10-09T00:00:00Z", staticBookmarks: [] }), { mode: "replace" });
  expect(state.userVariablesValid).toBe(true);
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.staticBookmarks).toEqual([]);
  expect(saved.panel.menus).toEqual(before.menus);
  expect(saved.urlRules).toEqual(before.urlRules);
  expect(saved.defaultUrlRuleUid).toBe("site");
  expect(saved.shortcuts).toEqual(before.shortcuts);
  persistence.destroy();
});

it("defers layout replacement until Save and preserves subsequent live layout edits on later saves", async () => {
  const { state, persistence } = await fixture();
  await saveLayouts();
  const before = await loadBarConfigurations();
  const incoming = { native: {}, browser: { bar: { ...before.browser.bar!, popupFontSize: 24 } } };
  await persistence.importSettings(JSON.stringify({ version: 2, exportedAt: "2026-10-09T00:00:00Z", barConfigurations: incoming }), { mode: "replace", bars: true });
  expect(await loadBarConfigurations()).toEqual(before);
  await persistence.saveSettings();
  expect(await loadBarConfigurations()).toEqual(incoming);
  expect(state.dirty.settings).toBe(false);
  await saveBarLayout("bar", "native", defaultMenuPlacement(), { gapRatio: .4, extraGaps: {} }, defaultNativeBarSettings());
  const edited = await loadBarConfigurations();
  state.renameBookmark("static", "link", "Later edit");
  await persistence.saveSettings();
  expect(await loadBarConfigurations()).toEqual(edited);
  persistence.destroy();
});

it("keeps unselected menu and shortcut references editable when replacing their dynamic bookmark definitions", async () => {
  const { state, persistence } = await fixture();
  state.addBookmark("dynamic", { uid: "live", name: "Live", type: "external" });
  state.addMenuItem("bar", { uid: "live-item", type: "dynamic", dynamicUid: "live" });
  state.removeShortcut({ kind: "slot", slot: "1" });
  state.setShortcutTarget({ kind: "slot", slot: "slot_1" }, { type: "dynamic", uid: "live" });
  state.addNativeShortcutSet({ uid: "keys", name: "Keys", shortcuts: [{ id: "live-key", key: "F1", type: "dynamic", dynamicUid: "live" }] });
  await persistence.saveSettings();
  const before = await loadConfig();
  await persistence.importSettings(JSON.stringify({ version: 2, exportedAt: "2026-10-09T00:00:00Z", dynamicBookmarks: [] }), { mode: "replace", menus: false, shortcuts: false });
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual([]);
  expect(saved.panel.menus).toEqual(before.panel.menus);
  expect(saved.shortcuts).toEqual(before.shortcuts);
  expect(saved.nativeShortcutSets).toEqual(before.nativeShortcutSets);
  persistence.destroy();
});

it("combines a staged layout replacement with a later merge without restoring discarded layouts", async () => {
  const { persistence } = await fixture();
  await saveLayouts();
  const before = await loadBarConfigurations();
  const metadata = { version: 2, exportedAt: "2026-10-09T00:00:00Z" };
  await persistence.importSettings(JSON.stringify({ ...metadata, barConfigurations: { native: {}, browser: {} } }), { mode: "replace", bars: true });
  const incoming = { native: {}, browser: { bar: before.browser.bar! } };
  await persistence.importSettings(JSON.stringify({ ...metadata, barConfigurations: incoming }), { bars: true });
  await persistence.saveSettings();
  expect(await loadBarConfigurations()).toEqual(incoming);
  persistence.destroy();
});

it("merges bar-only imports by mode and menu uid without resetting other layouts or definitions", async () => {
  const { state, persistence } = await fixture();
  state.addMenu({ uid: "local-bar", items: [] });
  await persistence.saveSettings();
  await saveLayouts();
  await saveBarLayout("local-bar", "native", defaultMenuPlacement(), { gapRatio: .4, extraGaps: {} }, defaultNativeBarSettings());
  const before = await loadBarConfigurations();
  const file = { version: 2, exportedAt: "2026-10-09T00:00:00.000Z", barConfigurations: { native: {}, browser: { bar: { ...before.browser.bar!, popupFontSize: 24 } } } };
  await persistence.importSettings(JSON.stringify(file), { bars: true });
  await persistence.saveSettings();
  expect(await loadBarConfigurations()).toEqual({ native: before.native, browser: { ...before.browser, bar: file.barConfigurations.browser.bar } });
  expect((await loadConfig()).panel.menus.map(menu => menu.uid)).toEqual(["bar", "local-bar"]);
  persistence.destroy();
});

it("does not bind dynamic bookmarks to a conflicting local rule when URL rules are deselected", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "site", name: "Local", patterns: ["*"] });
  const file = { version: 2, exportedAt: "2026-10-09T00:00:00.000Z", urlRules: [{ uid: "site", name: "Site", patterns: ["example.com"] }], dynamicBookmarks: [{ uid: "api", name: "API", type: "external", urlRuleUid: "site" }] };
  await persistence.importSettings(JSON.stringify(file), { urlRules: false });
  expect(state.settings.urlRules[0]?.patterns).toEqual(["*"]);
  expect(state.settings.dynamicBookmarks[0]).not.toHaveProperty("urlRuleUid");
  persistence.destroy();
});
