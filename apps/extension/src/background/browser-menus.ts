import browser, { type Runtime } from "webextension-polyfill";
import { isUrlMatchingSet, parseTemporaryAction, invertBookmarkActionUid, invertTemporaryActionUid, type LayoutEntry, type MenuView } from "@browserail/protocol";
import {
  defaultMenuPlacement, loadConfig, loadDisplayMode, loadWidgetEnabled, loadBrowserEditing, saveBrowserPlacement, toggleBrowserCollapsed, menuUrlPatterns,
  type BrowserMenuPlacement, type ExtensionConfig,
} from "../config";
import type { BrowserMenu, BrowserMenuState, MenuRequest } from "../page-operations/messages";
import { executeMenuAction } from "./execute-menu-action";
import { captureTemporaryUrl } from "./temporary";
import { hasWebsitePermission } from "../site-permissions";

export function menuVisibleForUrl(config: ExtensionConfig, uid: string, url: string | undefined): boolean {
  const menu = config.panel.menus.find(menu => menu.uid === uid);
  if (!menu || menu.enabled === false) return false;
  const patterns = menuUrlPatterns(menu, config);
  return !patterns.length || Boolean(url && patterns.some(patterns => isUrlMatchingSet(url, patterns)));
}

function leaves(entries: LayoutEntry[]): LayoutEntry[] {
  return entries.flatMap(entry => entry.kind === "folder" ? leaves(entry.children) : [entry]);
}

export function createBrowserMenus(changed: () => void) {
  const clients = new Map<Runtime.Port, BrowserMenu[]>();
  let snapshot: { config: ExtensionConfig; menus: BrowserMenu[]; active: boolean };
  let ready!: () => void;
  const firstSnapshot = new Promise<void>(resolve => { ready = resolve; });
  async function forTab(tabId: number): Promise<BrowserMenu[]> {
    await firstSnapshot;
    const [tab, mode, enabled] = await Promise.all([browser.tabs.get(tabId), loadDisplayMode(), loadWidgetEnabled()]);
    if (!snapshot.active || mode !== "browser" || !enabled || !await hasWebsitePermission(tab.url)) return [];
    return snapshot.menus.filter(menu => menuVisibleForUrl(snapshot.config, menu.view.uid, tab.url));
  }
  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if ((message as { type?: string } | null)?.type !== "browserMenusSnapshot") return undefined;
    if (sender.frameId !== 0 || sender.tab?.id === undefined) return Promise.resolve({ type: "state", menus: [] });
    changed();
    return forTab(sender.tab.id).then(menus => ({ type: "state", menus } satisfies BrowserMenuState));
  });
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== "browserail-menus" || port.sender?.frameId !== 0 || port.sender.tab?.id === undefined) return;
    clients.set(port, []);
    port.onDisconnect.addListener(() => { clients.delete(port); });
    port.onMessage.addListener((message: unknown) => {
      const request = message as MenuRequest;
      void handle(port, request).then(
        () => reply(port, request?.id),
        error => reply(port, request?.id, String(error)),
      );
    });
    changed();
  });
  function reply(port: Runtime.Port, id: number, error?: string): void {
    if (clients.has(port)) port.postMessage({ type: "reply", id, ...(error ? { error } : {}) });
  }
  async function handle(port: Runtime.Port, request: MenuRequest): Promise<void> {
    if (!request || !Number.isSafeInteger(request.id) || typeof request.menuUid !== "string") throw new Error("Invalid menu request");
    const tabId = port.sender!.tab!.id!;
    const [mode, enabled, config, tab] = await Promise.all([loadDisplayMode(), loadWidgetEnabled(), loadConfig(), browser.tabs.get(tabId)]);
    const menu = clients.get(port)?.find(menu => menu.view.uid === request.menuUid);
    if (!menu || mode !== "browser" || !enabled || !menuVisibleForUrl(config, request.menuUid, tab.url) || !await hasWebsitePermission(tab.url)) throw new Error("Menu is unavailable");
    const entries = leaves(menu.view.items);
    switch (request.type) {
      case "invoke":
        if (!entries.some(entry => (entry.kind === "bookmark" || entry.kind === "browserAction" || entry.kind === "menusToggle") && (entry.uid === request.actionUid || (entry.kind === "bookmark" && (entry.uid.startsWith("temporary:") ? invertTemporaryActionUid(entry.uid) : entry.uid.startsWith("bookmark:") ? invertBookmarkActionUid(entry.uid) : undefined) === request.actionUid)))) throw new Error("Action is unavailable");
        await executeMenuAction(request.actionUid, request.menuUid, String(tab.windowId), changed);
        break;
      case "fold":
        if (!menu.view.items.some(entry => entry.kind === "menuFold")) throw new Error("Fold action is unavailable");
        await toggleBrowserCollapsed(request.menuUid);
        changed();
        break;
      case "placement":
        if (!await loadBrowserEditing()) throw new Error("Menu editing is disabled");
        await saveBrowserPlacement(request.menuUid, request.placement);
        changed();
        break;
      case "temporarySave": {
        if (typeof request.uid !== "string" || typeof request.note !== "string" || !entries.some(entry => entry.kind === "bookmark" && entry.uid.startsWith("temporary:") && parseTemporaryAction(entry.uid).uid === request.uid)) throw new Error("Temporary bookmark is unavailable");
        const result = await captureTemporaryUrl(browser.tabs, config.panel.menus, request.uid, String(tab.windowId), true, request.note, await browser.bookmarks.getTree());
        if (result !== "saved") throw new Error("Temporary bookmark was not saved");
        changed();
        break;
      }
      default: throw new Error("Unknown menu request");
    }
  }
  return {
    forTab,
    connectedTabs: () => new Set(Array.from(clients.keys(), port => port.sender!.tab!.id!)),
    async publish(config: ExtensionConfig, views: MenuView[], placements: Record<string, BrowserMenuPlacement>, collapsed: Record<string, boolean>, active: boolean, editing = false): Promise<void> {
      const menus = views.filter(view => view.items.length > 0).map((view, index) => {
        const initial = defaultMenuPlacement(index, view.orientation, 0, view.buttonFontSize);
        return {
          view,
          placement: placements[view.uid] ?? { ...initial.boundPosition, itemWidth: initial.itemWidth, itemHeight: initial.itemHeight },
          collapsed: collapsed[view.uid] === true && view.items.some(entry => entry.kind === "menuFold"),
          editingLocked: !editing,
        };
      });
      snapshot = { config, menus, active }; ready();
      await Promise.all(Array.from(clients.keys(), async port => {
        try {
          const menus = await forTab(port.sender!.tab!.id!);
          if (!clients.has(port)) return;
          clients.set(port, menus);
          port.postMessage({ type: "state", menus } satisfies BrowserMenuState);
        } catch {
          clients.delete(port);
          port.disconnect();
        }
      }));
    },
  };
}
