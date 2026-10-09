import { expect, it } from "vitest";
import type { StoredNativeShortcutSet, UrlRule } from "@browserail/protocol";
import { nativeShortcutsForWindows } from "./native-shortcuts";

const rules: UrlRule[] = [
  { uid: "github", name: "GitHub", patterns: ["github.com", "!github.com/private/*"] },
  { uid: "game", name: "Game", patterns: ["game.example"] },
];
const sets: StoredNativeShortcutSet[] = [
  { uid: "sites", name: "Sites", urlRuleUids: ["github", "game"], shortcuts: [{ id: "site-key", key: "c", type: "browserAction", browserAction: "back" }] },
  { uid: "all", name: "All", shortcuts: [{ id: "global-key", key: " F1 ", type: "browserAction", browserAction: "reload" }] },
];

it("only sends scoped bindings for each window's active page and refreshes them after tab changes", () => {
  const windows = [{ uid: "a", activeTabUrl: "https://github.com/owner/repo" }, { uid: "b", activeTabUrl: "https://other.example" }];
  expect(nativeShortcutsForWindows(sets, rules, windows, true, true)).toEqual([
    { windowUid: "a", id: "site-key", key: "c" }, { windowUid: "a", id: "global-key", key: "F1" },
    { windowUid: "b", id: "global-key", key: "F1" },
  ]);
  windows[0]!.activeTabUrl = "https://github.com/private/secret";
  windows[1]!.activeTabUrl = "https://game.example/quest";
  expect(nativeShortcutsForWindows(sets, rules, windows, true, true)).toEqual([
    { windowUid: "a", id: "global-key", key: "F1" },
    { windowUid: "b", id: "site-key", key: "c" }, { windowUid: "b", id: "global-key", key: "F1" },
  ]);
});

it("releases all bindings when disabled, and missing rules or unknown page URLs do not widen a set's scope", () => {
  const windows = [{ uid: "a", activeTabUrl: "https://github.com" }];
  expect(nativeShortcutsForWindows(sets, rules, windows, false, true)).toEqual([]);
  expect(nativeShortcutsForWindows(sets, [], windows, true, true)).toEqual([{ windowUid: "a", id: "global-key", key: "F1" }]);
  expect(nativeShortcutsForWindows(sets, rules, [{ uid: "a" }], true, true)).toEqual([{ windowUid: "a", id: "global-key", key: "F1" }]);
});

it("retains custom bookmarks and actions without browser bookmarks permission, but never claims incomplete bindings", () => {
  const set: StoredNativeShortcutSet = { uid: "mixed", name: "Mixed", shortcuts: [
    { id: "bookmark", key: "a", url: "https://example.com" },
    { id: "custom", key: "b", type: "static", staticUid: "docs" },
    { id: "action", key: "c", type: "browserAction", browserAction: "back" },
    { id: "unbound", key: "d", type: "static" },
    { id: "no-key", key: " ", type: "browserAction", browserAction: "back" },
  ] };
  expect(nativeShortcutsForWindows([set], [], [{ uid: "a" }], true, false).map(binding => binding.id)).toEqual(["custom", "action"]);
});
