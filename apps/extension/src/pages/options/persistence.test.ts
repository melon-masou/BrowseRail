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

beforeEach(() => { local.values = {}; });
async function fixture() {
  const config = await loadConfig();
  config.instanceLabel = "Local instance";
  config.panel.menus = [{ uid: "bar", enabled: false, color: "#336699aa", dockColor: "#223344bb", items: [] }];
  config.staticBookmarks = [{ uid: "link", name: "Example", url: "https://example.com" }];
  config.shortcuts = [{ slot: "1", type: "static", staticUid: "link" }];
  await saveConfig(config);
  const state = createOptionsState({ label: config.instanceLabel, desktopUrl: config.desktopWidget.url, displayMode: "native", rootPrefix: [], syncEnabled: false }, settingsFromConfig(config));
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

it("round-trips both dynamic modes, code and commented exclusion rules without executing scripts", async () => {
  const { state, persistence } = await fixture();
  state.addUrlRule({ uid: "docs", name: "Docs", patterns: ["# context", "example.com", "# excluded", "!https://example.com/private"] });
  state.addBookmark("dynamic", { uid: "rule", name: "Rule", type: "rule", code: "preserved editor", urlRuleUid: "docs" });
  state.addBookmark("dynamic", { uid: "code", name: "Code", type: "code", code: "function dynamicBookmark() { return { newUrl: null, note: 'saved' }; }", urlRuleUids: ["docs"] });
  const exported = await persistence.exportSettings();
  await persistence.importSettings(JSON.stringify(exported));
  await persistence.saveSettings();
  const saved = await loadConfig();
  expect(saved.dynamicBookmarks).toEqual(exported.dynamicBookmarks);
  expect(saved.urlRules).toEqual(exported.urlRules);
  persistence.destroy();
});
