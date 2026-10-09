import browser, { type Runtime } from "webextension-polyfill";
import { isBarSettings, isMenuSpacing, matchesUrlRule, parseTemporaryAction, invertNavigationActionUid, type LayoutEntry, type MenuView } from "@browserail/protocol";
import {
  defaultMenuPlacement, loadConfig, loadDisplayMode, loadWidgetEnabled, loadBrowserEditing, loadBrowserPlacements, loadBrowserCollapsed, saveBarLayout, toggleBrowserCollapsed, menuUrlRules,
  type BrowserMenuPlacement, type ExtensionConfig,
} from "../../lib/config";
import type { BrowserMenu, BrowserMenuState, MenuRequest, MenuCommandResult } from "../../content/bar/messages";
import { executeMenuAction } from "../actions/execute-menu-action";
import { captureTemporaryUrl } from "../capture/temporary";
import { hasWebsitePermission } from "../../lib/browser/site-permissions";
import { openTemporaryConfirmation, temporaryConfirmationContext } from "../capture/confirmation";
import { requestBrowserMenuRefresh } from "./refresh";
import { createBrowserEditSession } from "./edit-session";
import { resolveMenuBookmarkTarget } from "../actions/menu-target";

export function menuVisibleForUrl(config: ExtensionConfig, uid: string, url: string | undefined): boolean {
  const menu = config.panel.menus.find(menu => menu.uid === uid);
  if (!menu || menu.enabled === false) return false;
  const rules = menuUrlRules(menu, config);
  return !rules.length || Boolean(url && rules.some(rule => matchesUrlRule(url, rule)));
}

function leaves(entries: LayoutEntry[]): LayoutEntry[] {
  return entries.flatMap(entry => entry.kind === "folder" ? leaves(entry.children) : [entry]);
}

function requireTemporaryBookmark(menu: BrowserMenu, uid: unknown): asserts uid is string {
  if (typeof uid !== "string" || !leaves(menu.view.items).some(entry => entry.kind === "bookmark" && entry.uid.startsWith("temporary:") && parseTemporaryAction(entry.uid).uid === uid)) throw new Error("Temporary bookmark is unavailable");
}

export function createBrowserMenus(changed: () => void | Promise<void>) {
  const editSession = createBrowserEditSession();
  let snapshot: { config: ExtensionConfig; menus: BrowserMenu[]; active: boolean };
  let ready!: () => void;
  const firstSnapshot = new Promise<void>(resolve => { ready = resolve; });
  async function forTab(tabId: number): Promise<BrowserMenu[]> {
    await firstSnapshot;
    const [tab, mode, enabled, placements, collapsed, editing] = await Promise.all([
      browser.tabs.get(tabId), loadDisplayMode(), loadWidgetEnabled(), loadBrowserPlacements(), loadBrowserCollapsed(), loadBrowserEditing(),
    ]);
    if (!snapshot.active || mode !== "browser" || !enabled || !await hasWebsitePermission(tab.url)) return [];
    return snapshot.menus.filter(menu => menuVisibleForUrl(snapshot.config, menu.view.uid, tab.url)
      && (collapsed[menu.view.uid] !== true || menu.view.items.some(entry => entry.kind === "menuFold"))).map(menu => ({
      ...menu, placement: placements[menu.view.uid] ?? menu.placement,
      collapsed: collapsed[menu.view.uid] === true,
      editingLocked: !editing,
    }));
  }
  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if ((message as { type?: string } | null)?.type === "temporarySaveConfirmed") {
      return saveConfirmed(message, sender).then(() => ({ saved: true }), error => ({ error: String(error) }));
    }
    const type = (message as { type?: string } | null)?.type;
    if (type !== "browserMenusSnapshot" && type !== "browserMenuCommand") return undefined;
    if (sender.frameId !== 0 || sender.tab?.id === undefined) {
      return Promise.resolve(type === "browserMenusSnapshot" ? { type: "state", menus: [] } : { error: "Invalid menu source" });
    }
    const tabId = sender.tab.id;
    return (async () => {
      await changed();
      if (type === "browserMenusSnapshot") return { type: "state", menus: await forTab(tabId) } satisfies BrowserMenuState;
      const result = await handle(tabId, (message as { command: MenuRequest }).command);
      await changed();
      return { ...(result !== undefined ? { result } : {}), state: { type: "state", menus: await forTab(tabId) } satisfies BrowserMenuState };
    })().catch(error => ({ error: String(error) }));
  });
  async function saveTemporary(config: ExtensionConfig, menuUid: string, uid: string, windowId: number, note: string): Promise<void> {
    const target = await resolveMenuBookmarkTarget(config, menuUid, uid, "temporary");
    const result = await captureTemporaryUrl(browser.tabs, config.temporaryBookmarks, target, String(windowId), true, note);
    if (result !== "saved") throw new Error("Temporary bookmark was not saved");
    await changed();
  }
  async function saveConfirmed(message: unknown, sender: Runtime.MessageSender): Promise<void> {
    const context = temporaryConfirmationContext(sender);
    const note = (message as { note?: unknown }).note;
    if (typeof note !== "string") throw new Error("Invalid temporary bookmark note");
    // The confirmation page carries the original window, so worker restarts
    // and focusing the popup cannot redirect capture to the extension page.
    await changed();
    const [menus, config, tab] = await Promise.all([forTab(context.sourceTabId), loadConfig(), browser.tabs.get(context.sourceTabId)]);
    const menu = menus.find(menu => menu.view.uid === context.menuUid);
    if (!menu || tab.windowId !== context.sourceWindowId || !menuVisibleForUrl(config, context.menuUid, tab.url)) throw new Error("Menu is unavailable");
    requireTemporaryBookmark(menu, context.uid);
    await saveTemporary(config, context.menuUid, context.uid, context.sourceWindowId, note);
    await requestBrowserMenuRefresh(context.sourceTabId);
  }
  async function handle(tabId: number, request: MenuRequest): Promise<MenuCommandResult | undefined> {
    if (!request || typeof request.menuUid !== "string") throw new Error("Invalid menu request");
    if (request.type === "editEnd") {
      if (typeof request.token !== "string") throw new Error("Invalid editing session");
      await editSession.end(tabId, request.token); return;
    }
    const [mode, enabled, config, tab, menus] = await Promise.all([loadDisplayMode(), loadWidgetEnabled(), loadConfig(), browser.tabs.get(tabId), forTab(tabId)]);
    const menu = menus.find(menu => menu.view.uid === request.menuUid);
    if (!menu || mode !== "browser" || !enabled || !menuVisibleForUrl(config, request.menuUid, tab.url) || !await hasWebsitePermission(tab.url)) throw new Error("Menu is unavailable");
    if (tab.windowId === undefined) throw new Error("Source window is unavailable");
    const entries = leaves(menu.view.items);
    switch (request.type) {
      case "editBegin":
        if (!await loadBrowserEditing() || typeof request.token !== "string" || !request.token) throw new Error("Menu editing is disabled");
        return editSession.begin(tabId, request.menuUid, request.token);
      case "invoke":
        if (!entries.some(entry => (entry.kind === "bookmark" || entry.kind === "browserAction" || entry.kind === "menusToggle" || entry.kind === "shortcutsToggle" || entry.kind === "autoHideToggle") && (entry.uid === request.actionUid || (entry.kind === "bookmark" && !entry.uid.startsWith("noop") && invertNavigationActionUid(entry.uid) === request.actionUid)))) throw new Error("Action is unavailable");
        await executeMenuAction(request.actionUid, request.menuUid, String(tab.windowId), changed);
        break;
      case "fold":
        if (!menu.view.items.some(entry => entry.kind === "menuFold")) throw new Error("Fold action is unavailable");
        await toggleBrowserCollapsed(request.menuUid);
        changed();
        break;
      case "layout":
        if (!await loadBrowserEditing()) throw new Error("Menu editing is disabled");
        if (!isMenuSpacing(request.spacing)) throw new Error("Invalid menu spacing");
        if (!isBarSettings(request.settings)) throw new Error("Invalid bar settings");
        if (!await editSession.owns(tabId, request.menuUid, request.token)) throw new Error("Bar editing is unavailable");
        await saveBarLayout(request.menuUid, "browser", { boundPosition: { anchor: request.placement.anchor, offsetX: request.placement.offsetX, offsetY: request.placement.offsetY }, itemWidth: request.placement.itemWidth, itemHeight: request.placement.itemHeight }, request.spacing, request.settings);
        changed();
        break;
      case "temporaryConfirm":
        requireTemporaryBookmark(menu, request.uid);
        return openTemporaryConfirmation({ menuUid: request.menuUid, uid: request.uid, sourceTabId: tabId, sourceWindowId: tab.windowId });
      case "temporarySave": {
        requireTemporaryBookmark(menu, request.uid);
        if (typeof request.note !== "string") throw new Error("Invalid temporary bookmark note");
        await saveTemporary(config, request.menuUid, request.uid, tab.windowId, request.note);
        break;
      }
      default: throw new Error("Unknown menu request");
    }
  }
  return {
    forTab,
    async publish(config: ExtensionConfig, views: MenuView[], placements: Record<string, BrowserMenuPlacement>, collapsed: Record<string, boolean>, active: boolean, editing = false): Promise<void> {
      const menus = views.filter(view => view.items.length > 0).map((view, index) => {
        const initial = defaultMenuPlacement(index, view.orientation, 0, view.buttonFontSize);
        return {
          view,
          placement: placements[view.uid] ?? { ...initial.boundPosition, itemWidth: initial.itemWidth, itemHeight: initial.itemHeight },
          collapsed: collapsed[view.uid] === true,
          editingLocked: !editing,
        };
      });
      snapshot = { config, menus, active }; ready();
      if (!active || !editing) await editSession.clear();
    },
  };
}
