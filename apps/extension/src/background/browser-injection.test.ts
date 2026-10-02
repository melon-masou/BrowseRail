import { beforeEach, expect, it, vi } from "vitest";
import type { Scripting } from "webextension-polyfill";

const state = vi.hoisted(() => ({
  origins: [] as string[],
  scripts: [] as Scripting.RegisteredContentScript[],
  shown: new Set<number>(),
  tabs: [] as { id: number; url: string }[],
  queryTabs: vi.fn<() => Promise<{ id: number; url: string }[]>>(),
  getTab: vi.fn<(id: number) => Promise<{ id: number; url: string }>>(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  permissions: { getAll: async () => ({ origins: state.origins }) },
  scripting: {
    getRegisteredContentScripts: async () => state.scripts,
    registerContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { state.scripts = scripts; },
    updateContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { state.scripts = scripts; },
    unregisterContentScripts: async () => { state.scripts = []; },
    executeScript: async ({ target }: { target: { tabId: number } }) => { state.shown.add(target.tabId); },
  },
  tabs: { query: state.queryTabs, get: state.getTab },
} }));
import { createBrowserInjection } from "./browser-injection";

beforeEach(() => {
  state.origins = []; state.scripts = []; state.shown.clear();
  state.tabs = [
    { id: 1, url: "https://example.com/" }, { id: 2, url: "https://other.com/" },
    { id: 3, url: "https://chromewebstore.google.com/detail/test" },
  ];
  state.queryTabs.mockReset(); state.queryTabs.mockImplementation(async () => state.tabs);
  state.getTab.mockReset(); state.getTab.mockImplementation(async id => {
    const tab = state.tabs.find(tab => tab.id === id);
    if (!tab) throw new Error("Tab is closed");
    return tab;
  });
});
const eligibility = [{ uid: "menu", patterns: [] }];

it("keeps native and ungranted instances out of webpages and activates eligible existing pages after authorization", async () => {
  const menus = { hasMenus: vi.fn(async (id: number) => id === 1), connectedTabs: () => new Set<number>() };
  const service = createBrowserInjection(menus);
  await service.reconcile(true, eligibility);
  expect(state.scripts).toEqual([]); expect(state.shown.size).toBe(0);
  state.origins = ["https://example.com/*"];
  await service.reconcile(false, eligibility);
  expect(state.scripts).toEqual([]); expect(state.shown.size).toBe(0);
  await service.reconcile(true, eligibility);
  expect(state.shown).toEqual(new Set([1]));
  expect(state.scripts[0]?.matches).toEqual(["https://example.com/*"]);
  await service.reconcile(false, eligibility);
  expect(state.scripts).toEqual([]);
  state.shown.clear();
  await service.reconcile(true, eligibility);
  expect(state.shown).toEqual(new Set([1]));
  state.origins = [];
  await service.reconcile(true, eligibility);
  expect(state.scripts).toEqual([]);
});

it("does not reinject into a page already displaying menus", async () => {
  state.origins = ["https://*/*"];
  const service = createBrowserInjection({ hasMenus: async id => id === 1, connectedTabs: () => new Set([1]) });
  await service.reconcile(true, eligibility);
  expect(state.shown.size).toBe(0);
});

it("avoids repeating tab queries and menu checks during unchanged syncs", async () => {
  state.origins = ["https://*/*"];
  const menus = { hasMenus: vi.fn(async () => false), connectedTabs: () => new Set<number>() };
  const service = createBrowserInjection(menus);
  await service.reconcile(true, eligibility);
  await service.reconcile(true, eligibility);
  await service.reconcile(true, eligibility);
  expect(state.queryTabs).toHaveBeenCalledTimes(1);
  expect(menus.hasMenus).toHaveBeenCalledTimes(2);
});

it("activates a formerly skipped page after its URL changes without rescanning unrelated tabs", async () => {
  state.origins = ["https://*/*"];
  const menus = { hasMenus: vi.fn(async (id: number) => state.tabs.find(tab => tab.id === id)?.url.endsWith("/visible") === true), connectedTabs: () => new Set<number>() };
  const service = createBrowserInjection(menus);
  await service.reconcile(true, eligibility);
  expect(state.shown.size).toBe(0);
  menus.hasMenus.mockClear();
  state.tabs[1]!.url = "https://other.com/visible";
  service.tabChanged(2);
  await service.reconcile(true, eligibility);
  expect(state.shown).toEqual(new Set([2]));
  expect(state.queryTabs).toHaveBeenCalledTimes(1);
  expect(menus.hasMenus.mock.calls.map(([id]) => id)).toEqual([2]);
});

it("activates pages when URL rules change even with unchanged permissions and connections", async () => {
  state.origins = ["https://*/*"];
  let matching = false;
  const service = createBrowserInjection({ hasMenus: async id => id === 1 && matching, connectedTabs: () => new Set<number>() });
  await service.reconcile(true, [{ uid: "menu", patterns: [["other.com"]] }]);
  matching = true;
  await service.reconcile(true, [{ uid: "menu", patterns: [["example.com"]] }]);
  expect(state.shown).toEqual(new Set([1]));
});

it("skips all page checks for empty menus and activates pages when a renderable menu appears", async () => {
  state.origins = ["https://*/*"];
  const service = createBrowserInjection({ hasMenus: async id => id === 1, connectedTabs: () => new Set<number>() });
  await service.reconcile(true, []);
  expect(state.queryTabs).not.toHaveBeenCalled();
  await service.reconcile(true, eligibility);
  expect(state.shown).toEqual(new Set([1]));
});
