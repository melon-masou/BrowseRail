import { beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";
import type { MenuView } from "@browserail/protocol";
import type { MenuRequest } from "../page-operations/messages";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  connect: vi.fn<(listener: (port: Runtime.Port) => void) => void>(),
  reload: vi.fn(),
  getTab: vi.fn(async (_id: number) => ({ id: 17, windowId: 42, url: "https://example.com/page" })),
  queryTabs: vi.fn(async (_query: { windowId: number }) => [{ id: 17, url: "https://example.com/page" }]),
  permission: vi.fn(async () => true),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: { onConnect: { addListener: mocks.connect }, onMessage: { addListener: vi.fn() } },
  permissions: { contains: mocks.permission },
  storage: { local: {
    get: async (key: string) => ({ [key]: mocks.storage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.storage, values); },
  } },
  tabs: { get: mocks.getTab, query: mocks.queryTabs, reload: mocks.reload },
  bookmarks: { getTree: async () => [] },
} }));

import { createBrowserMenus } from "./browser-menus";
import {
  loadConfig, saveConfig, loadDisplayMode, saveDisplayMode, loadBrowserPlacements, saveBrowserPlacement,
  loadMenuPlacements, saveMenuPlacement, removeBrowserPlacement, loadTemporaryValues, loadTemporaryNotes,
  saveBrowserEditing,
} from "../config";

beforeEach(() => {
  mocks.storage = {};
  mocks.connect.mockClear(); mocks.reload.mockClear();
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://example.com/page" });
  mocks.queryTabs.mockClear();
  mocks.permission.mockResolvedValue(true);
});

function client() {
  let listener!: (message: unknown, port: Runtime.Port) => void;
  const posted: unknown[] = [];
  const port: Runtime.Port = {
    name: "browserail-menus", sender: { frameId: 0, tab: { id: 17, windowId: 42, active: true, highlighted: true, incognito: false, index: 0, pinned: false } },
    postMessage: message => { posted.push(message); }, disconnect: () => {},
    onMessage: { addListener: callback => { listener = callback; }, removeListener: () => {}, hasListener: () => true },
    onDisconnect: { addListener: () => {}, removeListener: () => {}, hasListener: () => true },
  };
  mocks.connect.mock.calls.at(-1)![0](port);
  return { posted, async request(message: MenuRequest) {
    listener(message, port);
    await vi.waitFor(() => expect(posted).toContainEqual(expect.objectContaining({ type: "reply", id: message.id })));
  } };
}

const view: MenuView = { uid: "source", orientation: "row", items: [
  { kind: "browserAction", uid: "browserAction:reload", label: "Reload" },
  { kind: "bookmark", uid: "temporary:slot", label: "Later" },
] };

async function fixture() {
  await saveDisplayMode("browser");
  const config = await loadConfig();
  config.panel.menus = [{ uid: "source", orientation: "row", attachmentMode: "free", items: [
    { uid: "reload", type: "browserAction", browserAction: "reload" }, { uid: "slot", type: "temporary" },
  ] }];
  await saveConfig(config);
  return config;
}

it("keeps display mode and browser placements local when menu configuration is replaced", async () => {
  expect(await loadDisplayMode()).toBe("native");
  await saveDisplayMode("browser");
  const native = { boundPosition: { anchor: "topLeft" as const, offsetX: 80, offsetY: 90 }, itemWidth: 100, itemHeight: 40 };
  const injected = { anchor: "bottomRight" as const, offsetX: 30, offsetY: 40, itemWidth: 120, itemHeight: 50 };
  await saveMenuPlacement("menu", native);
  await saveBrowserPlacement("menu", injected);
  await saveConfig(await loadConfig());
  await saveDisplayMode("native"); await saveDisplayMode("browser");
  expect(await loadDisplayMode()).toBe("browser");
  expect((await loadBrowserPlacements()).menu).toEqual(injected);
  expect((await loadMenuPlacements()).menu).toEqual(native);
  expect(await loadConfig()).not.toHaveProperty("displayMode");
  await removeBrowserPlacement("menu");
  expect((await loadBrowserPlacements()).menu).toBeUndefined();
  expect((await loadMenuPlacements()).menu).toEqual(native);
});

it("shows free menus in a matching webpage without a desktop connection and removes them on mode switch", async () => {
  const config = await fixture();
  config.panel.menus[0]!.urlRuleUids = ["web"];
  config.urlRules = [{ uid: "web", name: "Web", patterns: ["https://example.com/*"] }];
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  expect(page.posted.at(-1)).toMatchObject({ type: "state", menus: [{ view: { uid: "source" } }] });
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://other.com/" });
  await service.publish(config, [view], {}, {}, true);
  expect(page.posted.at(-1)).toEqual({ type: "state", menus: [] });
  mocks.getTab.mockResolvedValue({ id: 17, windowId: 42, url: "https://example.com/page" });
  await service.publish(config, [view], {}, {}, false);
  expect(page.posted.at(-1)).toEqual({ type: "state", menus: [] });
});

it("executes a webpage's browser action on its own window and rejects it after switching to native", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ id: 1, type: "invoke", menuUid: "source", actionUid: "browserAction:reload" });
  expect(mocks.queryTabs).toHaveBeenCalledWith({ active: true, windowId: 42 });
  expect(mocks.reload).toHaveBeenCalledWith(17);
  await saveDisplayMode("native");
  await page.request({ id: 2, type: "invoke", menuUid: "source", actionUid: "browserAction:reload" });
  expect(mocks.reload).toHaveBeenCalledTimes(1);
  expect(page.posted.at(-1)).toMatchObject({ id: 2, error: expect.any(String) });
});

it("saves a confirmed temporary URL with its note and rejects unlisted actions", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  await page.request({ id: 1, type: "temporarySave", menuUid: "source", uid: "slot", note: "Read later" });
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/page");
  expect((await loadTemporaryNotes()).slot).toBe("Read later");
  await page.request({ id: 2, type: "invoke", menuUid: "source", actionUid: "temporarySave:slot?confirmed=1" });
  expect(page.posted.at(-1)).toMatchObject({ id: 2, error: expect.any(String) });
});

it("only saves webpage placement while browser editing is enabled", async () => {
  const config = await fixture();
  const service = createBrowserMenus(() => {}); const page = client();
  await service.publish(config, [view], {}, {}, true);
  const placement = { anchor: "bottomRight" as const, offsetX: 30, offsetY: 40, itemWidth: 120, itemHeight: 50 };
  await page.request({ id: 1, type: "placement", menuUid: "source", placement });
  expect(page.posted.at(-1)).toMatchObject({ id: 1, error: expect.any(String) });
  expect((await loadBrowserPlacements()).source).toBeUndefined();
  await saveBrowserEditing(true);
  await service.publish(config, [view], {}, {}, true, true);
  expect(page.posted.at(-1)).toMatchObject({ menus: [{ editingLocked: false }] });
  await page.request({ id: 2, type: "placement", menuUid: "source", placement });
  expect((await loadBrowserPlacements()).source).toEqual(placement);
  await saveDisplayMode("native");
  await page.request({ id: 3, type: "placement", menuUid: "source", placement: { ...placement, offsetX: 99 } });
  expect((await loadBrowserPlacements()).source).toEqual(placement);
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
