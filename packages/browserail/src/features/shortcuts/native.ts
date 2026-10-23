import { customBookmarkUid, isShortcutActionType, matchesUrlRule, type StoredNativeShortcutSet, type SyncedNativeShortcut, type UrlRule } from "@browserail/protocol";

export function nativeShortcutSetMatches(set: Pick<StoredNativeShortcutSet, "urlRuleUids">, rules: readonly UrlRule[], url?: string): boolean {
  return !set.urlRuleUids?.length || Boolean(url && set.urlRuleUids.some(uid => {
    const rule = rules.find(rule => rule.uid === uid);
    return rule && matchesUrlRule(url, rule);
  }));
}

export function nativeShortcutsForWindows(
  sets: readonly StoredNativeShortcutSet[], rules: readonly UrlRule[],
  windows: readonly { uid: string; activeTabUrl?: string }[], enabled: boolean, bookmarksAvailable: boolean,
): SyncedNativeShortcut[] {
  if (!enabled) return [];
  return windows.flatMap(window => sets
    .filter(set => nativeShortcutSetMatches(set, rules, window.activeTabUrl))
    .flatMap(set => set.shortcuts)
    .filter(shortcut => shortcut.key.trim() && (isShortcutActionType(shortcut.type)
      || (shortcut.type && shortcut.type !== "bookmark" ? Boolean(customBookmarkUid(shortcut)) : bookmarksAvailable && Boolean(shortcut.path || shortcut.url))))
    .map(shortcut => ({ windowUid: window.uid, id: shortcut.id, key: shortcut.key.trim() })));
}
