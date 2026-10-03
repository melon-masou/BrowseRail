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
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: {
    id: "browserail", getURL: (path: string) => `chrome-extension://browserail/${path}`,
    onMessage: { addListener: (listener: (message: unknown, sender: Runtime.MessageSender) => unknown) => { mocks.message = listener; } },
  },
  action: { setPopup: mocks.setPopup, openPopup: mocks.openPopup },
  tabs: { get: mocks.getTab, sendMessage: mocks.sendToTab },
  contextMenus: {
    removeAll: async () => {},
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

import { createBrowserEditingMenu } from "./browser-editing";
import { loadBrowserEditing, loadConfig, saveConfig, saveDisplayMode } from "../config";

beforeEach(() => {
  mocks.storage = {}; mocks.menu = {}; mocks.menus.clear();
  mocks.setPopup.mockClear(); mocks.openPopup.mockReset().mockResolvedValue(); mocks.sendToTab.mockClear();
  mocks.getTab.mockResolvedValue({ id: 7, windowId: 1 });
});

it("provides a checked editing switch on the extension icon in browser mode", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu(); await menu.update("browser", true);
  expect(mocks.menu).toMatchObject({ contexts: ["action"], type: "checkbox", enabled: true, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] }, {
    id: 7, windowId: 1, index: 0, active: true, pinned: false, highlighted: false, incognito: false,
  });
  await vi.waitFor(async () => expect(await loadBrowserEditing()).toBe(true));
  await vi.waitFor(() => expect(mocks.menu.checked).toBe(true));
  await vi.waitFor(() => expect(mocks.sendToTab).toHaveBeenCalledWith(7, { type: "browserMenusRefresh" }, { frameId: 0 }));
});

it("disables the editing switch in native mode and when the widget is disabled", async () => {
  const menu = createBrowserEditingMenu(); await menu.update("native", true);
  expect(mocks.menu).toMatchObject({ enabled: false, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] });
  await menu.update("native", true);
  expect(await loadBrowserEditing()).toBe(false);
  await saveDisplayMode("browser");
  await menu.update("browser", false);
  expect(mocks.menu).toMatchObject({ enabled: false, checked: false });
});

it("confirms edited name and URL before adding a persistent static bookmark in native mode with the widget disabled", async () => {
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "existing", name: "Existing", url: "https://example.com/old" }];
  await saveConfig(config);
  const menu = createBrowserEditingMenu(); await menu.update("native", false);
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
  const restarted = createBrowserEditingMenu(); await restarted.update("native", false);
  expect(await mocks.message!({ type: "staticSaveConfirmed", name: "Edited name", url: "https://example.com/edited" }, {
    id: "browserail", url,
  })).toEqual({ saved: true });
  const saved = await loadConfig();
  expect(saved.staticBookmarks[0]).toEqual(config.staticBookmarks[0]);
  expect(saved.staticBookmarks[1]).toMatchObject({ name: "Edited name", url: "https://example.com/edited" });
  expect(saved.staticBookmarks[1]?.uid).toBeTruthy();
  expect(saved.panel.menus).toEqual(config.panel.menus);
});

it("leaves static bookmarks unchanged when the clicked tab has no URL", async () => {
  const menu = createBrowserEditingMenu(); await menu.update("native", true);
  const add = [...mocks.menus.values()].find(entry => entry.type !== "checkbox")!;
  mocks.clicked!({ menuItemId: add.id!, editable: false, modifiers: [] });
  expect((await loadConfig()).staticBookmarks).toEqual([]);
  expect(mocks.openPopup).not.toHaveBeenCalled();
});

it("rejects webpage confirmation messages, other confirmation kinds, and blank URLs without creating a bookmark", async () => {
  const menu = createBrowserEditingMenu(); await menu.update("browser", true);
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
  const menu = createBrowserEditingMenu(); await menu.update("native", true);
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
