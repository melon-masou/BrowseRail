import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ storage: {} as Record<string, unknown>, session: {} as Record<string, unknown>, back: vi.fn(), forward: vi.fn(), reload: vi.fn() }));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: { session: {
    get: async (key: string) => ({ [key]: mocks.session[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.session, values); },
    remove: async (key: string) => { delete mocks.session[key]; },
  }, local: {
    get: async (key: string) => ({ [key]: mocks.storage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mocks.storage, values); },
  } },
  tabs: { query: async (query: { windowId: number }) => [{ id: query.windowId + 1 }], goBack: mocks.back, goForward: mocks.forward, reload: mocks.reload },
} }));

import { loadConfig, saveConfig, saveShortcutsEnabled, loadShortcutsEnabled } from "../../lib/config";
import { canExecuteShortcut, executeShortcutAction } from "./actions";
import { defaultNativeBarSettings } from "@browserail/protocol";
import { saveBarLayout, loadBarConfigurations, defaultMenuPlacement } from "../../lib/config";
import { autoHideEnabled } from "../../lib/config/auto-hide";

beforeEach(() => { mocks.storage = {}; mocks.session = {}; vi.clearAllMocks(); });

it("toggles the selected bar's auto-hide through a shortcut without changing its settings", async () => {
  const config = await loadConfig();
  config.panel.menus = [{ uid: "shortcut-hide", items: [] }];
  await saveConfig(config);
  await saveBarLayout("shortcut-hide", "native", defaultMenuPlacement(), { gapRatio: 0, extraGaps: {} }, { ...defaultNativeBarSettings(), autoHide: "start" });
  const saved = structuredClone(mocks.storage);
  const host = { changed: vi.fn(), toggleFold: vi.fn(async () => {}) };
  await executeShortcutAction({ type: "autoHideToggle", menuUid: "shortcut-hide" }, config, "42", host);
  const bars = await loadBarConfigurations();
  expect(await autoHideEnabled("shortcut-hide", "native", bars.native["shortcut-hide"]!)).toBe(false);
  expect(mocks.storage).toEqual(saved);
  expect(host.changed).toHaveBeenCalledOnce();
});

it("executes independent actions on the source window and lets a shortcut switch turn shortcuts back on", async () => {
  const config = await loadConfig();
  config.panel.menus = [{ uid: "one", items: [] }, { uid: "two", enabled: false, items: [] }];
  await saveConfig(config);
  const host = { changed: vi.fn(), toggleFold: vi.fn(async () => {}) };
  await executeShortcutAction({ type: "browserAction", browserAction: "back" }, config, "42", host);
  expect(mocks.back).toHaveBeenCalledWith(43);
  await executeShortcutAction({ type: "browserAction", browserAction: "forward" }, config, "42", host);
  expect(mocks.forward).toHaveBeenCalledWith(43);
  await executeShortcutAction({ type: "browserAction", browserAction: "reload" }, config, "42", host);
  expect(mocks.reload).toHaveBeenCalledWith(43);
  await executeShortcutAction({ type: "menusToggle", targetMenuUids: ["one", "two"] }, config, "42", host);
  expect((await loadConfig()).panel.menus.every(menu => menu.enabled)).toBe(true);
  await executeShortcutAction({ type: "menuFold", menuUid: "one" }, config, "42", host);
  expect(host.toggleFold).toHaveBeenCalledWith("one");
  await expect(executeShortcutAction({ type: "menuFold", menuUid: "missing" }, config, "42", host)).rejects.toThrow("unavailable");
  await saveShortcutsEnabled(false);
  expect(await canExecuteShortcut("browserAction")).toBe(false);
  expect(await canExecuteShortcut("static")).toBe(false);
  expect(await canExecuteShortcut("shortcutsToggle")).toBe(true);
  await executeShortcutAction({ type: "shortcutsToggle" }, config, "42", host);
  expect(await loadShortcutsEnabled()).toBe(true);
  expect(await canExecuteShortcut("static")).toBe(true);
});
