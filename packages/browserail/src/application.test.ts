import { expect, it } from "vitest";
import type { RuntimeAdapter, StorageArea } from "@browserail/runtime-adapter";
import { initializeBrowserail, type BrowserailHost } from "./runtime";
import { loadConfig, saveConfig } from "./lib/config/index";
import { createBrowserMenus } from "./features/bar/menus";
import { createMenuSync } from "./features/sync/index";
import { createDebugLog } from "./features/desktop/debug-log";
import { createWindowFocus } from "./features/desktop/focus";
import { executeMenuAction } from "./features/actions/execute-menu-action";

function memoryStorage(): StorageArea {
  const values: Record<string, unknown> = {};
  return {
    async get(keys = null) {
      if (keys === null) return structuredClone(values);
      const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(names.map(key => [key, structuredClone(values[key])]));
    },
    async set(update) { Object.assign(values, structuredClone(update)); },
    async remove(keys) { for (const key of typeof keys === "string" ? [keys] : keys) delete values[key]; },
  };
}

it("renders and opens saved links with an injected host while retaining unavailable bookmark and native settings", async () => {
  let currentUrl = "https://example.com/start";
  const unsupported = (): never => { throw new Error("Host operation is unavailable"); };
  const events = { addListener() {}, removeListener() {} };
  const tab = () => ({ id: 1, windowId: 1, active: true, url: currentUrl });
  const adapter: RuntimeAdapter = {
    storage: { local: memoryStorage(), session: memoryStorage(), sync: undefined, onChanged: events },
    bookmarks: { isAvailable: async () => false, getTree: unsupported, get: unsupported, create: unsupported },
    navigation: {
      get: async () => tab(), query: async () => [tab()], create: unsupported,
      update: async (_id, update) => { currentUrl = update.url; return tab(); },
      goBack: unsupported, goForward: unsupported, reload: unsupported,
    },
    messaging: { id: "test-host", send: unsupported, sendToTab: unsupported, sendToExtension: unsupported, onMessage: events },
    permissions: { getAll: async () => ({ origins: ["https://example.com/*"] }), contains: async () => true, request: unsupported, remove: unsupported },
    capabilities: { browserBookmarks: false, browserSync: false, websitePermissions: false, browserShortcuts: false, externalExtensions: false, desktopConnection: false },
    resourceUrl: unsupported, platformInfo: async () => ({ os: "linux" }),
  };
  const host: BrowserailHost = {
    browserKind: () => "test-host",
    listWindows: async () => [{ uid: "1", focused: true, activeTabUrl: currentUrl, bounds: { x: 0, y: 0, width: 1024, height: 768 } }],
    commands: unsupported, openShortcutSettings: unsupported,
    onPermissionsChanged: () => () => {}, onTabRemoved: () => () => {}, onTabUpdated: () => () => {},
    openConfirmation: unsupported, runRewrite: unsupported,
  };
  initializeBrowserail(adapter, host);
  const config = await loadConfig();
  config.staticBookmarks = [{ uid: "docs", name: "Docs", url: "https://example.com/docs" }];
  config.panel.menus = [{ uid: "bar", items: [
    { uid: "link", type: "static", staticUid: "docs" },
    { uid: "browser-bookmark", type: "bookmark", path: ["Saved", "Original"], url: "https://example.com/original" },
  ] }];
  config.nativeShortcutSets = [{ uid: "native", name: "Desktop", shortcuts: [{ id: "open-docs", key: "F1", type: "static", staticUid: "docs" }] }];
  await saveConfig(config);
  const saved = await loadConfig();
  const menus = createBrowserMenus(async () => {});
  const sync = createMenuSync({
    log: createDebugLog(), focus: createWindowFocus(), browserMenus: menus,
    browserInjection: { reconcile: async () => {} },
    desktop: { isOpen: () => false, send: unsupported, requestWindowPairing: unsupported },
  });
  await sync.request();
  const rendered = await menus.forTab(1);
  const link = rendered[0]?.view.items.find(entry => entry.kind === "bookmark" && entry.label === "Docs");
  expect(link).toBeDefined();
  await executeMenuAction(link!.uid, "bar", "1", () => {});
  expect(currentUrl).toBe("https://example.com/docs");
  expect(await loadConfig()).toEqual(saved);
});
