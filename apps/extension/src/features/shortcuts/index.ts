import browser from "webextension-polyfill";
import {
  actionUid, customBookmarkUid, isCustomBookmarkType, isShortcutActionType, type ShortcutTarget,
} from "@browserail/protocol";
import { combineRootAndItemPath, findBookmarkNodeByPath, type BookmarkNode } from "../../lib/bookmarks";
import { canUseBookmarks } from "../../lib/browser/bookmarks-capability";
import { navigateToUrl } from "../../lib/browser/navigation";
import {
  loadBookmarkRootPrefix, loadConfig, loadDisplayMode, normalizeShortcutAction, toggleBrowserCollapsed, type ExtensionConfig,
} from "../../lib/config";
import { requestBrowserMenuRefresh } from "../bar/refresh";
import { executeMenuAction } from "../actions/execute-menu-action";
import { nativeShortcutSetMatches } from "./native";
import { canExecuteShortcut, executeShortcutAction } from "./actions";

export interface ShortcutsHost {
  requestSync(): Promise<void>;
  focusedWindowUid(): string | undefined;
  /** Folds a menu on the desktop; throws while the desktop is disconnected. */
  toggleNativeFold(menuUid: string): void;
}

/** Browser keyboard shortcuts (commands) and the desktop's native shortcuts. */
export function createShortcuts(host: ShortcutsHost) {
  async function runShortcutAction(target: unknown, config: ExtensionConfig, windowUid: string): Promise<void> {
    const action = normalizeShortcutAction(target);
    if (!action) throw new Error("Action is unavailable");
    const mode = await loadDisplayMode();
    await executeShortcutAction(action, config, windowUid, {
      changed: host.requestSync,
      async toggleFold(menuUid) {
        if (mode === "browser") await toggleBrowserCollapsed(menuUid);
        else host.toggleNativeFold(menuUid);
      },
    });
    if (mode === "browser") {
      const [tab] = await browser.tabs.query({ active: true, windowId: Number(windowUid) });
      if (tab?.id !== undefined) await requestBrowserMenuRefresh(tab.id);
    }
  }

  async function runTarget(target: ShortcutTarget, config: ExtensionConfig, windowUid: string): Promise<void> {
    if (isShortcutActionType(target.type)) {
      await runShortcutAction(target, config, windowUid);
      return;
    }
    const tabMode = target.tabMode || "replace";
    if (isCustomBookmarkType(target.type)) {
      const uid = customBookmarkUid(target);
      if (uid) await executeMenuAction(actionUid(target.type, uid, tabMode), undefined, windowUid, host.requestSync);
      return;
    }
    if (!await canUseBookmarks()) return;
    if (target.path) {
      const rootPrefix = await loadBookmarkRootPrefix();
      const effectivePath = combineRootAndItemPath(rootPrefix, target.path);
      const tree = (await browser.bookmarks.getTree()) as BookmarkNode[];
      const node = findBookmarkNodeByPath(tree, effectivePath, target.url);
      if (node?.url) {
        await navigateToUrl(browser, windowUid, node.url, tabMode);
      }
    } else if (target.url) {
      await navigateToUrl(browser, windowUid, target.url, tabMode);
    }
  }

  browser.commands.onCommand.addListener(async (command) => {
    const config = await loadConfig();
    const target = config.shortcuts.find((s) => s.slot === command);
    if (!target || !await canExecuteShortcut(target.type)) return;
    const currentWindow = await browser.windows.getCurrent();
    if (!currentWindow?.id) return;
    await runTarget(target, config, String(currentWindow.id));
  });

  return {
    /** Runs a native shortcut the desktop reported, in its window or the last focused one. */
    async executeNative(shortcutId: string, targetWindowUid?: string): Promise<void> {
      const config = await loadConfig();
      const set = config.nativeShortcutSets.find(set => set.shortcuts.some(shortcut => shortcut.id === shortcutId));
      const target = set?.shortcuts.find(shortcut => shortcut.id === shortcutId);
      if (!set || !target || !await canExecuteShortcut(target.type)) return;
      const targetWindow = targetWindowUid ?? host.focusedWindowUid() ?? (await browser.windows.getLastFocused())?.id;
      if (!targetWindow) return;
      if (set.urlRuleUids?.length) {
        const [tab] = await browser.tabs.query({ active: true, windowId: Number(targetWindow) });
        if (!nativeShortcutSetMatches(set, config.urlRules, tab?.url)) return;
      }
      await runTarget(target, config, String(targetWindow));
    },
  };
}
export type Shortcuts = ReturnType<typeof createShortcuts>;
