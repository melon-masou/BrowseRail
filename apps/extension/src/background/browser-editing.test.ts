import { beforeEach, expect, it, vi } from "vitest";
import type { Menus } from "webextension-polyfill";

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  menu: {} as Menus.CreateCreatePropertiesType,
  clicked: undefined as ((info: Menus.OnClickData) => void) | undefined,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  runtime: {},
  contextMenus: {
    removeAll: async () => {},
    create: (menu: Menus.CreateCreatePropertiesType, done: () => void) => { mocks.menu = menu; done(); },
    update: async (_id: string, changes: Menus.UpdateUpdatePropertiesType) => { Object.assign(mocks.menu, changes); },
    onClicked: { addListener: (listener: (info: Menus.OnClickData) => void) => { mocks.clicked = listener; } },
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
import { loadBrowserEditing, saveDisplayMode } from "../config";

beforeEach(() => { mocks.storage = {}; mocks.menu = {}; });

it("provides a checked editing switch on the extension icon in browser mode", async () => {
  await saveDisplayMode("browser");
  const menu = createBrowserEditingMenu(); await menu.update("browser", true);
  expect(mocks.menu).toMatchObject({ contexts: ["action"], type: "checkbox", enabled: true, checked: false });
  mocks.clicked!({ menuItemId: mocks.menu.id!, checked: true, editable: false, modifiers: [] });
  await vi.waitFor(async () => expect(await loadBrowserEditing()).toBe(true));
  await vi.waitFor(() => expect(mocks.menu.checked).toBe(true));
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
