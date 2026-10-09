import { beforeEach, expect, it, vi } from "vitest";
import type { Menus, Tabs, Runtime } from "webextension-polyfill";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  menu: {} as Menus.CreateCreatePropertiesType,
  menus: new Map<string, Menus.CreateCreatePropertiesType>(),
  clicked: undefined as ((info: Menus.OnClickData, tab?: Tabs.Tab) => void) | undefined,
  message: undefined as ((message: unknown, sender: Runtime.MessageSender) => unknown) | undefined,
  setPopup: vi.fn(async (_options: { tabId: number; popup: string }) => {}),
  openPopup: vi.fn(async (_options: { windowId: number }) => {}),
  getTab: vi.fn(async (_id: number) => ({ id: 7, windowId: 1 })),
  sendToTab: vi.fn(async () => ({ updated: true })),
  setNativeEditing: vi.fn((_editing: boolean) => {}),
  broadcast: vi.fn(async (_message: unknown) => {}),
  queryTabs: vi.fn(async () => [{ id: 7 }, { id: 8 }]),
  removeMenus: vi.fn(async () => {}),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: {
    id: "browserail", getURL: (path: string) => `chrome-extension://browserail/${path}`,
    sendMessage: mocks.broadcast,
    onMessage: { addListener: (listener: (message: unknown, sender: Runtime.MessageSender) => unknown) => { mocks.message = listener; } },
  },
  action: { setPopup: mocks.setPopup, openPopup: mocks.openPopup },
  tabs: { get: mocks.getTab, query: mocks.queryTabs, sendMessage: mocks.sendToTab },
  contextMenus: {
    removeAll: mocks.removeMenus,
    create: (menu: Menus.CreateCreatePropertiesType, done: () => void) => {
      mocks.menus.set(String(menu.id), menu);
      if (menu.type === "checkbox") mocks.menu = menu;
      done();
    },
    update: async (id: string, changes: Menus.UpdateUpdatePropertiesType) => { Object.assign(mocks.menus.get(id)!, changes); },
    onClicked: { addListener: (listener: (info: Menus.OnClickData, tab?: Tabs.Tab) => void) => { mocks.clicked = listener; } },
  },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (key: string) => ({ [key]: mocks.storage[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(mocks.storage, values); },
    },
  },
} }));

import { createBrowserEditingMenu } from "./menu";
import { loadBrowserEditing, loadConfig, saveConfig, saveDisplayMode } from "../../lib/config";

beforeEach(() => {
  mocks.storage = {}; mocks.menu = {}; mocks.menus.clear();
  mocks.setPopup.mockClear(); mocks.openPopup.mockReset().mockResolvedValue(); mocks.sendToTab.mockClear();
  mocks.getTab.mockResolvedValue({ id: 7, windowId: 1 });
  mocks.setNativeEditing.mockClear();
  mocks.broadcast.mockClear(); mocks.queryTabs.mockClear(); mocks.removeMenus.mockReset().mockResolvedValue();
});

it("provides a checked editing switch on the extension icon in browser mode", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("browser", true);
  expect(mocks.menu).toMatchObject({ contexts: ["action"], type: "checkbox", enabled: true, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] }, {
    id: 7, windowId: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false,
  });
  await vi.waitFor(async () => expect(await loadBrowserEditing()).toBe(true));
  await vi.waitFor(() => expect(mocks.menu.checked).toBe(true));
  await vi.waitFor(() => expect(mocks.sendToTab).toHaveBeenCalledWith(7, { type: "browserMenusRefresh" }, { frameId: 0 }));
});

it("disables the editing switch without a desktop connection and when the widget is disabled", async () => {
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("native", true);
  expect(mocks.menu).toMatchObject({ enabled: false, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] });
  await menu.update("native", true);
  expect(await loadBrowserEditing()).toBe(false);
  await saveDisplayMode("browser");
  await menu.update("browser", false);
  expect(mocks.menu).toMatchObject({ enabled: false, checked: false });
});

it("controls Native editing from the extension and reflects desktop state without changing browser editing", async () => {
  await saveDisplayMode("native");
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
  await menu.updateNativeEditing(false);
  expect(mocks.menu).toMatchObject({ enabled: true, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] });
  await vi.waitFor(() => expect(mocks.setNativeEditing).toHaveBeenCalledWith(true));
  expect(await loadBrowserEditing()).toBe(false);
  expect(mocks.sendToTab).not.toHaveBeenCalled();
  await menu.updateNativeEditing(true);
  expect(mocks.menu).toMatchObject({ enabled: true, checked: true });
  await menu.updateNativeEditing(undefined);
  expect(mocks.menu).toMatchObject({ enabled: false, checked: false });
});

it("uses browser editing state in browser mode even when Native editing was enabled", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
  await menu.updateNativeEditing(true);
  expect(mocks.menu).toMatchObject({ enabled: true, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] });
  await vi.waitFor(async () => expect(await loadBrowserEditing()).toBe(true));
  expect(mocks.setNativeEditing).not.toHaveBeenCalled();
});

const optionsSender = { id: "browserail", url: "chrome-extension://browserail/options.html" };

it("enables editing from options and refreshes open page menus using the same state as the context menu", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
  await menu.update("browser", true);
  expect(await mocks.message!({ type: "getMenuEditingState" }, optionsSender)).toEqual({ enabled: true, editing: false });
  expect(await mocks.message!({ type: "setMenuEditing", editing: true }, optionsSender)).toEqual({ enabled: true, editing: true });
  expect(await loadBrowserEditing()).toBe(true);
  expect(mocks.menu.checked).toBe(true);
  expect(mocks.sendToTab).toHaveBeenCalledWith(7, { type: "browserMenusRefresh" }, { frameId: 0 });
  expect(mocks.sendToTab).toHaveBeenCalledWith(8, { type: "browserMenusRefresh" }, { frameId: 0 });
  mocks.broadcast.mockClear();
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: false, editable: false, modifiers: [] }, {
    id: 7, windowId: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false,
  });
  await vi.waitFor(() => expect(mocks.broadcast).toHaveBeenCalledWith({ type: "menuEditingStateChanged", enabled: true, editing: false }));
  expect(await mocks.message!({ type: "getMenuEditingState" }, optionsSender)).toEqual({ enabled: true, editing: false });
});

it("reflects Native editing acknowledgements in options and refuses editing when disconnected", async () => {
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
  expect(await mocks.message!({ type: "setMenuEditing", editing: true }, optionsSender)).toEqual({ enabled: false, editing: false });
  expect(mocks.setNativeEditing).not.toHaveBeenCalled();
  await menu.updateNativeEditing(false);
  await mocks.message!({ type: "setMenuEditing", editing: true }, optionsSender);
  expect(mocks.setNativeEditing).toHaveBeenCalledWith(true);
  await menu.updateNativeEditing(true);
  expect(mocks.broadcast).toHaveBeenLastCalledWith({ type: "menuEditingStateChanged", enabled: true, editing: true });
  expect(await mocks.message!({ type: "getMenuEditingState" }, optionsSender)).toEqual({ enabled: true, editing: true });
  expect(await loadBrowserEditing()).toBe(false);
  await menu.updateNativeEditing(undefined);
  expect(await mocks.message!({ type: "getMenuEditingState" }, optionsSender)).toEqual({ enabled: false, editing: false });
});

it("keeps options editing usable when context menus are unsupported", async () => {
  await saveDisplayMode("browser");
  mocks.removeMenus.mockRejectedValue(new Error("Context menus unavailable"));
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
    await menu.update("browser", true);
    expect(await mocks.message!({ type: "setMenuEditing", editing: true }, optionsSender)).toEqual({ enabled: true, editing: true });
    expect(await loadBrowserEditing()).toBe(true);
    expect(mocks.sendToTab).toHaveBeenCalledWith(7, { type: "browserMenusRefresh" }, { frameId: 0 });
  } finally { report.mockRestore(); }
});

it("rejects editing commands from web pages", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing });
  await menu.update("browser", true);
  expect(mocks.message!({ type: "setMenuEditing", editing: true }, { id: "browserail", url: "https://example.com" })).toBeUndefined();
  expect(await loadBrowserEditing()).toBe(false);
});

it("confirms edited name, URL and tags before adding a persistent static bookmark in native mode with the widget disabled", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "existing", name: "Existing", url: "https://example.com/old" }];
  await saveConfig(config);
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("native", false);
  const add = [...mocks.menus.values()].find(entry => entry.type !== "checkbox")!;
  expect(add).toMatchObject({ contexts: ["action"] });
  expect(add.enabled).not.toBe(false);
  mocks.clicked!({ menuItemId: add.id!, editable: false, modifiers: [] }, {
    id: 7, windowId: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false,
    title: "Current page", url: "https://example.com/current",
  });
  await vi.waitFor(() => expect(mocks.openPopup).toHaveBeenCalledWith({ windowId: 1 }));
  const url = mocks.setPopup.mock.calls.find(([options]) => options.popup)![0].popup;
  expect(new URL(url).searchParams.get("name")).toBe("Current page");
  expect(new URL(url).searchParams.get("url")).toBe("https://example.com/current");
  await vi.waitFor(() => expect(mocks.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: "" }));
  expect((await loadConfig()).staticBookmarks).toEqual(config.staticBookmarks);
  // The extension confirmation URL carries its context across worker restarts.
  const restarted = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await restarted.update("native", false);
  expect(await mocks.message!({ type: "staticSaveConfirmed", name: "Edited name", url: "https://example.com/edited", tags: [" gbf ", "work", "gbf", ""] }, {
    id: "browserail", url,
  })).toEqual({ saved: true });
  const saved = await loadConfig();
  expect(saved.staticBookmarks[0]).toEqual(config.staticBookmarks[0]);
  expect(saved.staticBookmarks[1]).toMatchObject({ name: "Edited name", url: "https://example.com/edited", tags: ["gbf", "work"] });
  expect(saved.staticBookmarks[1]?.uid).toBeTruthy();
  expect(saved.panel.menus).toEqual(config.panel.menus);
});

it("leaves static bookmarks unchanged when the clicked tab has no URL", async () => {
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("native", true);
  const add = [...mocks.menus.values()].find(entry => entry.type !== "checkbox")!;
  mocks.clicked!({ menuItemId: add.id!, editable: false, modifiers: [] });
  expect((await loadConfig()).staticBookmarks).toEqual([]);
  expect(mocks.openPopup).not.toHaveBeenCalled();
});

it("rejects webpage confirmation messages, other confirmation kinds, and blank URLs without creating a bookmark", async () => {
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("browser", true);
  const message = { type: "staticSaveConfirmed", name: "Name", url: "https://example.com" };
  expect(await mocks.message!(message, { id: "browserail", url: "https://example.com" })).toMatchObject({ error: expect.any(String) });
  const page = "chrome-extension://browserail/temporary-confirm.html?sourceTabId=7&sourceWindowId=1";
  expect(await mocks.message!(message, { id: "browserail", url: page })).toMatchObject({ error: expect.any(String) });
  expect(await mocks.message!({ ...message, url: "   " }, { id: "browserail", url: `${page}&kind=static` })).toMatchObject({ error: expect.any(String) });
  mocks.getTab.mockResolvedValue({ id: 7, windowId: 2 });
  expect(await mocks.message!(message, { id: "browserail", url: `${page}&kind=static` })).toMatchObject({ error: expect.any(String) });
  expect((await loadConfig()).staticBookmarks).toEqual([]);
});

it("clears the popup entry and leaves bookmarks untouched when opening confirmation fails", async () => {
  const menu = createBrowserEditingMenu({ setNativeEditing: mocks.setNativeEditing }); await menu.update("native", true);
  const add = [...mocks.menus.values()].find(entry => entry.type !== "checkbox")!;
  mocks.openPopup.mockRejectedValue(new Error("Opening failed"));
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    mocks.clicked!({ menuItemId: add.id!, editable: false, modifiers: [] }, {
      id: 7, windowId: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false,
      title: "Current page", url: "https://example.com/current",
    });
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
    expect(mocks.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: "" });
    expect((await loadConfig()).staticBookmarks).toEqual([]);
  } finally { report.mockRestore(); }
});
