import { beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import { defaultBarSettings, defaultNativeBarSettings, type MenuView } from "@browserail/protocol";
import type { MenuRequest, MenuReply } from "../page-operations/messages";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  syncStorage: {} as Record<string, unknown>,
  message: vi.fn<(listener: (message: unknown, sender: Runtime.MessageSender) => unknown) => void>(),
  popupSupported: true,
  popupUrls: {} as Record<number, string>,
  setPopup: vi.fn(async (options: { tabId: number; popup: string }) => { mocks.popupUrls[options.tabId] = options.popup; }),
  openPopup: vi.fn(async (_options: { windowId: number }) => {}),
  reload: vi.fn(),
  getTab: vi.fn(async (_id: number) => ({ id: 17, windowId: 42, url: "https://example.com/page" })),
  queryTabs: vi.fn(async (_query: { windowId: number }) => [{ id: 17, url: "https://example.com/page" }]),
  permission: vi.fn(async () => true),
  sendToTab: vi.fn(async () => ({ updated: true })),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: {
    id: "browserail", getURL: (path: string) => `chrome-extension://browserail/${path}`,
    onMessage: { addListener: mocks.message },
  },
  get action() { return { setPopup: mocks.setPopup, openPopup: mocks.popupSupported ? mocks.openPopup : undefined }; },
  permissions: { contains: mocks.permission },
  storage: { local: {
    get: async (key: string) => ({ [key]: mocks.storage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.storage, values); },
  }, sync: {
    get: async (key: string) => ({ [key]: mocks.syncStorage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.syncStorage, values); },
  } },
  tabs: { get: mocks.getTab, query: mocks.queryTabs, reload: mocks.reload, sendMessage: mocks.sendToTab },
  bookmarks: { getTree: async () => [] },
} }));

import { createBrowserMenus } from "./browser-menus";
import {
  loadConfig, saveConfig, loadDisplayMode, saveDisplayMode, loadBrowserPlacements,
  loadMenuPlacements, removeBrowserPlacement, loadTemporaryValues, loadTemporaryNotes,
  saveBrowserEditing,
  saveSyncEnabled,
  saveBarLayout, loadBarConfigurations, resolveBarConfiguration, defaultMenuPlacement,
} from "../config";

beforeEach(() => {
  mocks.storage = {};
  mocks.syncStorage = {};
  mocks.reload.mockClear(); mocks.sendToTab.mockClear();
  mocks.message.mockClear(); mocks.popupSupported = true; mocks.popupUrls = {};
  mocks.setPopup.mockClear(); mocks.openPopup.mockReset(); mocks.openPopup.mockResolvedValue();
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://example.com/page" });
  mocks.queryTabs.mockClear().mockResolvedValue([{ id: 17, url: "https://example.com/page" }]);
  mocks.permission.mockResolvedValue(true);
});

function client() {
  const posted: unknown[] = [];
  const sender: Runtime.MessageSender = {
    id: "browserail", frameId: 0, tab: { id: 17, windowId: 42, active: true, highlighted: true, incognito: false, index: 0, pinned: false },
  };
  const listener = mocks.message.mock.calls.at(-1)![0];
  return {
    posted,
    async snapshot() { const result = await listener({ type: "browserMenusSnapshot" }, sender); posted.push(result); return result; },
    async request(command: MenuRequest) {
      const result = await listener({ type: "browserMenuCommand", command }, sender) as MenuReply;
      posted.push(result); return result;
    },
  };
}

const view: MenuView = { uid: "source", orientation: "row", items: [
  { kind: "browserAction", uid: "browserAction:reload", label: "Reload" },
  { kind: "bookmark", uid: "temporary:slot", label: "Later" },
] };

async function fixture() {
  await saveDisplayMode("browser");
  const config = await loadConfig();
  config.panel.menus = [{ uid: "source", items: [
    { uid: "reload", type: "browserAction", browserAction: "reload" }, { uid: "slot-button", type: "temporary", temporaryUid: "slot" },
  ] }];
  config.temporaryBookmarks = [{ uid: "slot", name: "Later" }];
  await saveConfig(config);
  return config;
}

it("publishes menu snapshots without sending unsolicited updates to webpages", async () => {
  const config = await fixture();
  const changed = vi.fn();
  const service = createBrowserMenus(changed); const page = client();
  await service.publish(config, [view], {}, {}, true);
  expect(changed).not.toHaveBeenCalled();
  expect(page.posted).toEqual([]);
  expect(mocks.sendToTab).not.toHaveBeenCalled();
  expect(await page.snapshot()).toMatchObject({ type: "state", menus: [{ view: { uid: "source" } }] });
});

it("keeps display mode and browser placements local when menu configuration is replaced", async () => {
  expect(await loadDisplayMode()).toBe("native");
  await saveDisplayMode("browser");
  const native = { boundPosition: { anchor: "topLeft" as const, offsetX: 80, offsetY: 90 }, itemWidth: 100, itemHeight: 40 };
  const injected = { anchor: "bottomRight" as const, offsetX: 30, offsetY: 40, itemWidth: 120, itemHeight: 50 };
  await saveBarLayout("menu", "native", native, { gapRatio: 0.11, extraGaps: {} }, defaultNativeBarSettings());
  await saveBarLayout("menu", "browser", { boundPosition: { anchor: injected.anchor, offsetX: injected.offsetX, offsetY: injected.offsetY }, itemWidth: injected.itemWidth, itemHeight: injected.itemHeight }, { gapRatio: 0.11, extraGaps: {} }, defaultBarSettings());
  await saveConfig(await loadConfig());
  await saveDisplayMode("native"); await saveDisplayMode("browser");
  expect(await loadDisplayMode()).toBe("browser");
  expect((await loadBrowserPlacements()).menu).toEqual(injected);
  expect((await loadMenuPlacements()).menu).toEqual(native);
  expect(await loadConfig()).not.toHaveProperty("displayMode");
  await removeBrowserPlacement("menu");
  expect((await loadBrowserPlacements()).menu).not.toEqual(injected);
  expect((await loadMenuPlacements()).menu).toEqual(native);
});

it("shows free menus in a matching webpage without a desktop connection and removes them on mode switch", async () => {
  const config = await fixture();
  config.panel.menus[0]!.urlRuleUids = ["web"];
  config.urlRules = [{ uid: "web", name: "Web", patterns: ["https://example.com/*"] }];
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.snapshot();
  expect(page.posted.at(-1)).toMatchObject({ type: "state", menus: [{ view: { uid: "source" } }] });
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://other.com/" });
  await service.publish(config, [view], {}, {}, true);
  await page.snapshot();
  expect(page.posted.at(-1)).toEqual({ type: "state", menus: [] });
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://example.com/page" });
  await service.publish(config, [view], {}, {}, false);
  await page.snapshot();
  expect(page.posted.at(-1)).toEqual({ type: "state", menus: [] });
});

it("follows saved global matching while separately configured menus use their own matching", async () => {
  const config = await fixture();
  config.panel.menus.push({ ...config.panel.menus[0]!, uid: "custom", urlRuleUids: ["work"] });
  config.urlRules = [
    { uid: "personal", name: "Personal", patterns: ["example.com"] },
    { uid: "work", name: "Work", patterns: ["other.com"] },
  ];
  config.defaultUrlRuleUid = "personal";
  await saveConfig(config);
  const service = createBrowserMenus(() => {});
  const views = [view, { ...view, uid: "custom" }];
  await service.publish(await loadConfig(), views, {}, {}, true);
  expect((await service.forTab(17)).map(menu => menu.view.uid)).toEqual(["source"]);

  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://other.com/" });
  expect((await service.forTab(17)).map(menu => menu.view.uid)).toEqual(["custom"]);

  config.urlRules[0]!.patterns = [];
  await saveConfig(config);
  await service.publish(await loadConfig(), views, {}, {}, true);
  expect((await service.forTab(17)).map(menu => menu.view.uid)).toEqual(["custom"]);

  delete config.defaultUrlRuleUid;
  await saveConfig(config);
  await service.publish(await loadConfig(), views, {}, {}, true);
  expect((await service.forTab(17)).map(menu => menu.view.uid)).toEqual(["source", "custom"]);
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://third.com/" });
  expect((await service.forTab(17)).map(menu => menu.view.uid)).toEqual(["source"]);
});

it("restores the selected global matching and its definitions from Chrome sync", async () => {
  const config = await fixture();
  config.urlRules = [{ uid: "personal", name: "Personal", patterns: ["example.com"] }];
  config.defaultUrlRuleUid = "personal";
  await saveSyncEnabled(true);
  await saveConfig(config);
  mocks.storage.config = { ...config, urlRules: [], defaultUrlRuleUid: undefined };

  const service = createBrowserMenus(() => {});
  await service.publish(await loadConfig(), [view], {}, {}, true);
  expect(await service.forTab(17)).toHaveLength(1);
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://other.com/" });
  expect(await service.forTab(17)).toEqual([]);
});

it("keeps both modes' bar settings local when shared configuration syncs", async () => {
  const config = await fixture();
  await saveBarLayout("source", "browser", defaultMenuPlacement(), { gapRatio: 0.2, extraGaps: {} }, { ...defaultBarSettings(), expandAlignment: "center" });
  await saveBarLayout("source", "native", defaultMenuPlacement(), { gapRatio: 0.4, extraGaps: {} }, defaultNativeBarSettings());
  await saveSyncEnabled(true);
  await saveConfig(config);
  const bars = await loadBarConfigurations();
  expect(resolveBarConfiguration(bars, "browser", "source").expandAlignment).toBe("center");
  expect(resolveBarConfiguration(bars, "native", "source").expandAlignment).toBe("edge");
  expect(mocks.syncStorage).not.toHaveProperty("bar_configurations");
});

it("executes a webpage's browser action on its own window and rejects it after switching to native", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ type: "invoke", menuUid: "source", actionUid: "browserAction:reload" });
  expect(mocks.queryTabs).toHaveBeenCalledWith({ active: true, windowId: 42 });
  expect(mocks.reload).toHaveBeenCalledWith(17);
  await saveDisplayMode("native");
  await page.request({ type: "invoke", menuUid: "source", actionUid: "browserAction:reload" });
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  expect(page.posted.at(-1)).toMatchObject({ error: expect.any(String) });
});

it("saves a confirmed temporary URL with its note and rejects unlisted actions", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ type: "temporarySave", menuUid: "source", uid: "slot", note: "Read later" });
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/page");
  expect((await loadTemporaryNotes()).slot).toBe("Read later");
  await page.request({ type: "invoke", menuUid: "source", actionUid: "temporarySave:slot?confirmed=1" });
  expect(page.posted.at(-1)).toMatchObject({ error: expect.any(String) });
});

it("opens confirmation in the original window, restores icon clicks, and saves after a background restart", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ type: "temporaryConfirm", menuUid: "source", uid: "slot" });
  expect(page.posted.at(-1)).toMatchObject({ result: "opened" });
  expect(await loadTemporaryValues()).toEqual({});
  const url = mocks.setPopup.mock.calls.find(([options]) => options.popup)![0].popup;
  expect(new URL(url).protocol).toBe("chrome-extension:");
  expect(mocks.openPopup).toHaveBeenCalledWith({ windowId: 42 });
  expect(mocks.popupUrls[17]).toBe("");
  const restarted = createBrowserMenus(() => {});
  await restarted.publish(config, [view], {}, {}, true);
  const message = mocks.message.mock.calls.at(-1)![0];
  const result = await message({ type: "temporarySaveConfirmed", note: "Read later" }, {
    id: "browserail", url,
  });
  expect(result).toEqual({ saved: true });
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/page");
  expect((await loadTemporaryNotes()).slot).toBe("Read later");
});

it("only requests prompt fallback for popup opening failure, never for an unavailable temporary bookmark", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  mocks.openPopup.mockRejectedValue(new Error("Toolbar popups are unsupported"));
  await page.request({ type: "temporaryConfirm", menuUid: "source", uid: "slot" });
  expect(page.posted.at(-1)).toMatchObject({ result: "prompt" });
  expect(await loadTemporaryValues()).toEqual({});
  expect(mocks.popupUrls[17]).toBe("");
  await page.request({ type: "temporaryConfirm", menuUid: "source", uid: "missing" });
  expect(page.posted.at(-1)).toMatchObject({ error: expect.any(String) });
  expect(page.posted.at(-1)).not.toHaveProperty("result");
});

it("uses prompt when the toolbar popup API is absent without installing a confirmation entry", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  mocks.popupSupported = false;
  await page.request({ type: "temporaryConfirm", menuUid: "source", uid: "slot" });
  expect(page.posted.at(-1)).toMatchObject({ result: "prompt" });
  expect(mocks.popupUrls[17]).toBeUndefined();
  expect(await loadTemporaryValues()).toEqual({});
});

it("rejects confirmation messages from webpages and rechecks permissions before saving", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ type: "temporaryConfirm", menuUid: "source", uid: "slot" });
  const url = mocks.setPopup.mock.calls.find(([options]) => options.popup)![0].popup;
  const message = mocks.message.mock.calls.at(-1)![0];
  expect(await message({ type: "temporarySaveConfirmed", note: "" }, {
    id: "browserail", frameId: 0, url: "https://example.com/page",
  })).toMatchObject({ error: expect.any(String) });
  mocks.permission.mockResolvedValue(false);
  expect(await message({ type: "temporarySaveConfirmed", note: "" }, {
    id: "browserail", url,
  })).toMatchObject({ error: expect.any(String) });
  expect(await loadTemporaryValues()).toEqual({});
});

it("only saves browser layout while editing is enabled and keeps Native settings independent", async () => {
  const config = await fixture();
  const native = { ...defaultNativeBarSettings(), gapRatio: 0.4, extraGaps: { "item-1": 0.7 }, placement: defaultMenuPlacement() };
  await saveBarLayout("source", "native", native.placement, native, native);
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  const placement = { anchor: "bottomRight" as const, offsetX: 30, offsetY: 40, itemWidth: 120, itemHeight: 50 };
  const settings = { ...defaultBarSettings(), orientation: "row" as const, expandAlignment: "center" as const, buttonFontSize: 20 };
  const spacing = { gapRatio: 0.2, extraGaps: { "item-1": 0.5 } };
  const command = { type: "layout" as const, menuUid: "source", placement, settings, spacing };
  expect(await page.request(command)).toHaveProperty("error");
  expect((await loadBrowserPlacements()).source).toBeUndefined();
  await saveBrowserEditing(true);
  expect(await page.request(command)).not.toHaveProperty("error");
  expect((await loadBrowserPlacements()).source).toEqual(placement);
  const bars = await loadBarConfigurations();
  expect(bars.native.source).toEqual(native);
  expect(bars.browser.source).toMatchObject({ ...settings, ...spacing });
  await saveDisplayMode("native");
  expect(await page.request({ ...command, placement: { ...placement, offsetX: 99 } })).toHaveProperty("error");
  expect((await loadBrowserPlacements()).source).toEqual(placement);
  await saveConfig(await loadConfig());
  expect(await loadBarConfigurations()).toEqual(bars);
});

it("does not offer empty menus or menus on websites whose permission was revoked", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {});
  await service.publish(config, [{ ...view, items: [] }], {}, {}, true);
  expect(await service.forTab(17)).toEqual([]);
  await service.publish(config, [view], {}, {}, true);
  expect(await service.forTab(17)).toHaveLength(1);
  mocks.permission.mockResolvedValue(false);
  expect(await service.forTab(17)).toEqual([]);
});
