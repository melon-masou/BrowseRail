import browser from "webextension-polyfill";
import { barSettingsFromView, normalizeMenuSpacing, type MenuView, type SyncedMenu } from "@browserail/protocol";
import { resolveMenuItems, type BookmarkNode } from "../../lib/bookmarks";
import { projectMenuSpacing } from "../../lib/bookmarks/spacing";
import { canUseBookmarks } from "../../lib/browser/bookmarks-capability";
import { listBrowserWindows } from "../../lib/browser/windows";
import {
  loadBarConfigurations, loadBookmarkRootPrefix, loadBrowserCollapsed, loadBrowserEditing, loadBrowserPlacements,
  loadConfig, loadDisplayMode, loadDynamicValues, loadShortcutsEnabled, loadTemporaryNotes, loadWidgetEnabled,
  resolveBarConfiguration,
} from "../../lib/config";
import { resolveItemIcons } from "../../lib/icons/item-icons";
import { nativeShortcutsForWindows } from "../actions/native-shortcuts";
import { autoHideEnabled, reconcileAutoHideOverrides } from "../bar/auto-hide";
import { menuVisibleForUrl as isMenuVisibleForUrl, type createBrowserMenus } from "../bar/menus";
import type { DesktopConnection } from "../desktop/connection";
import type { DebugLog } from "../desktop/debug-log";
import type { WindowFocus } from "../desktop/focus";

export interface MenuSyncHost {
  log: DebugLog;
  focus: WindowFocus;
  desktop: DesktopConnection;
  browserMenus: ReturnType<typeof createBrowserMenus>;
  browserInjection: { reconcile(enabled: boolean): Promise<void> };
}

/**
 * Builds every enabled menu from the saved settings and publishes it to the browser-mode bars and
 * the desktop. Requests made while a sync runs collapse into one more pass.
 */
export function createMenuSync(host: MenuSyncHost) {
  const { log, focus, desktop } = host;
  let revision = 0;
  let syncRequested = false;
  let syncRunning = false;
  let syncTask: Promise<void> | undefined;
  const resetMenuUids = new Set<string>();

  function request(): Promise<void> {
    syncRequested = true;
    if (!syncRunning) {
      syncTask = drain();
    }
    return syncTask!;
  }

  async function drain(): Promise<void> {
    syncRunning = true;
    try {
      while (syncRequested) {
        syncRequested = false;
        await syncOnce();
      }
    } finally {
      syncRunning = false;
    }
  }

  async function syncOnce(): Promise<void> {
    const bookmarksAvailable = await canUseBookmarks();
    const configTask = loadConfig();
    const [config, windows, rootPrefix, bookmarkTree, dynamicValues, temporaryNotes, mode, enabled, browserPlacements, browserCollapsed, browserEditing, barConfigs, shortcutsEnabled] = await Promise.all([
      configTask,
      listBrowserWindows(),
      loadBookmarkRootPrefix(),
      bookmarksAvailable ? browser.bookmarks.getTree().catch(() => []) : [],
      configTask.then(config => loadDynamicValues(config.dynamicBookmarks.map(bookmark => bookmark.uid))),
      loadTemporaryNotes(),
      loadDisplayMode(),
      loadWidgetEnabled(),
      loadBrowserPlacements(),
      loadBrowserCollapsed(),
      loadBrowserEditing(),
      loadBarConfigurations(),
      loadShortcutsEnabled(),
    ]);
    const dynamicByUid = new Map((config.dynamicBookmarks ?? []).map((db) => [db.uid, db]));
    const dynamicResolve = (dynamicUid: string) => {
      const def = dynamicByUid.get(dynamicUid);
      if (!def) return undefined;
      const value = dynamicValues[dynamicUid];
      return {
        name: def.name,
        ...(value?.url ? { url: value.url } : {}),
        ...(value?.title ? { title: value.title } : {}),
      };
    };
    const activeMenus = config.panel.menus.filter((menu) => menu.enabled !== false);
    await reconcileAutoHideOverrides(barConfigs, config.panel.menus.map(menu => menu.uid));
    const menuStates = await Promise.all(
      activeMenus.map(async (menu, index) => {
        async function viewForMode(mode: "native" | "browser"): Promise<MenuView> {
          const settings = mode === "native" ? resolveBarConfiguration(barConfigs, "native", menu.uid, index) : resolveBarConfiguration(barConfigs, "browser", menu.uid, index);
          const hideEnabled = await autoHideEnabled(menu.uid, mode, settings);
          const items = await resolveMenuItems(menu.items, menu.color, settings.expandDirection, rootPrefix, {
            tree: bookmarkTree as BookmarkNode[],
            dynamicResolve, temporaryNotes, staticBookmarks: config.staticBookmarks, temporaryBookmarks: config.temporaryBookmarks, externalActions: config.externalActions,
            bookmarksAvailable, shortcutsEnabled, autoHideEnabled: hideEnabled,
          });
          return { uid: menu.uid, items: await resolveItemIcons(items), ...barSettingsFromView(settings), autoHideEnabled: hideEnabled, ...projectMenuSpacing(normalizeMenuSpacing(settings), menu.items, items, bookmarkTree as BookmarkNode[], rootPrefix),
            ...(menu.color ? { color: menu.color } : {}),
            ...(menu.dockColor ? { dockColor: menu.dockColor } : {}),
            ...(config.globalCss ? { globalCss: config.globalCss } : {}),
            ...(menu.cssClass ? { cssClass: menu.cssClass } : {}),
            ...(menu.style ? { style: menu.style } : {}),
          };
        }
        const settings = resolveBarConfiguration(barConfigs, "native", menu.uid, index);
        const view = await viewForMode(mode);
        return {
          uid: menu.uid, isFree: settings.attachmentMode === "free", view,
          placement: settings.placement, attachmentMode: settings.attachmentMode, onTopMode: settings.onTopMode,
        };
      }),
    );
    focus.updateFrom(windows);

    const menuVisibleForUrl = (uid: string, url: string | undefined): boolean => isMenuVisibleForUrl(config, uid, url);

    await host.browserMenus.publish(config, menuStates.map(menu => menu.view), browserPlacements, browserCollapsed, enabled && mode === "browser", browserEditing);
    await host.browserInjection.reconcile(enabled && mode === "browser");
    if (!desktop.isOpen()) return;
    // Read after the awaits above, so a focus change during publishing is reflected.
    const lastFocusedWindowUid = focus.get();

    // Bound menus are emitted once for each browser window because URL visibility, focus state,
    // geometry, and the native owner are window-specific.
    const nativeMenuStates = mode === "native" && enabled ? menuStates : [];
    const boundMenus = nativeMenuStates.filter((menu) => !menu.isFree);
    const syncedBoundMenus: SyncedMenu[] = windows.flatMap((window) => {
      const windowSnapshot = {
        uid: window.uid,
        bounds: window.bounds,
        focused: window.uid === lastFocusedWindowUid,
      };
      return boundMenus.map((menu) => ({
        view: menu.view,
        placement: menu.placement,
        native: {
          attachmentMode: menu.attachmentMode,
          onTopMode: menu.onTopMode,
          visible: menuVisibleForUrl(menu.uid, window.activeTabUrl),
        },
        target: { kind: "window" as const, window: windowSnapshot },
      }));
    });

    const lastFocusedWindow =
      windows.find((w) => w.uid === lastFocusedWindowUid) ?? windows.find((w) => w.focused);
    // A free menu is emitted exactly once for the instance while it has a browser window.
    // URL matching only toggles native.visible (hidden-but-kept), same as bound menus, so a
    // URL change never destroys and recreates the free surface.
    const syncedFreeMenus: SyncedMenu[] = windows.length === 0
      ? []
      : nativeMenuStates
          .filter((menu) => menu.isFree)
          .map((menu) => {
            return {
              view: menu.view,
              placement: menu.placement,
              native: {
                attachmentMode: "free" as const,
                onTopMode: menu.onTopMode,
                visible: menuVisibleForUrl(menu.uid, lastFocusedWindow?.activeTabUrl),
              },
              target: {
                kind: "free" as const,
                ...(lastFocusedWindow
                  ? {
                      referenceWindow: {
                        uid: lastFocusedWindow.uid,
                        bounds: lastFocusedWindow.bounds,
                        focused: lastFocusedWindow.uid === lastFocusedWindowUid,
                      },
                    }
                  : {}),
              },
            };
          });

    const syncedMenus = [...syncedBoundMenus, ...syncedFreeMenus];
    const hasActiveAttachment = syncedBoundMenus.some(({ native }) => native.visible);
    const hasAllAttachment = syncedBoundMenus.some(
      ({ native }) => native.attachmentMode === "all",
    );

    log.log(
      "Sync",
      `syncOnce: totalWindows=${windows.length}, menus=${menuStates.length}, free=${syncedFreeMenus.length}, lastFocused=${lastFocusedWindowUid}, rev=${revision + 1}`,
    );

    const nativeShortcuts = nativeShortcutsForWindows(config.nativeShortcutSets, config.urlRules, windows,
      shortcutsEnabled && mode === "native", bookmarksAvailable);

    desktop.send({
      type: "sync",
      revision: ++revision,
      menus: syncedMenus,
      ...(resetMenuUids.size > 0 ? { resetMenuUids: Array.from(resetMenuUids) } : {}),
      ...(nativeShortcuts.length > 0 ? { nativeShortcuts } : {}),
    });
    resetMenuUids.clear();

    if (hasActiveAttachment || nativeShortcuts.length) {
      const windowUids = new Set([
        ...nativeShortcuts.filter(shortcut => shortcut.windowUid === lastFocusedWindowUid).map(shortcut => shortcut.windowUid),
        ...syncedBoundMenus
          .filter(({ target }) => target.kind === "window" && (target.window.focused || hasAllAttachment))
          .map(({ target }) => (target.kind === "window" ? target.window.uid : "")),
      ]);
      for (const windowUid of windowUids) {
        desktop.requestWindowPairing(windowUid);
      }
    }
  }

  return {
    request,
    /** The next desktop sync tells the desktop to drop the saved layout of this menu. */
    resetNativeLayout(menuUid: string): void { resetMenuUids.add(menuUid); },
  };
}
