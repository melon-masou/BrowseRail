import { expect, it } from "vitest";
import { createOptionsState, type SettingsDraft } from "./state";

function initialSettings(): SettingsDraft {
  return {
    menus: [
      {
        uid: "menu",
        items: [
          { uid: "static-item", type: "static", staticUid: "static" },
          { uid: "other-item", type: "temporary", temporaryUid: "temporary" },
        ],
        urlRuleUids: ["removed-rule", "kept-rule"],
      },
    ],
    urlRules: [
      { uid: "removed-rule", name: "Removed", patterns: [] },
      { uid: "kept-rule", name: "Kept", patterns: [] },
    ],
    defaultUrlRuleUid: "removed-rule",
    staticBookmarks: [{ uid: "static", name: "Static", url: "https://example.com" }],
    temporaryBookmarks: [{ uid: "temporary", name: "Temporary" }],
    dynamicBookmarks: [
      { uid: "dynamic", name: "Dynamic", type: "code", code: "", urlRuleUid: "removed-rule" },
    ],
    shortcuts: [{ slot: "slot_1", type: "static", staticUid: "static", tabMode: "newTab" }],
    nativeShortcuts: [
      { id: "native", key: "Ctrl+A", type: "static", staticUid: "static", tabMode: "replace" },
    ],
  };
}
function createState(settings = initialSettings()) {
  return createOptionsState(
    {
      label: "Instance",
      desktopUrl: "ws://127.0.0.1:17653",
      displayMode: "native",
      rootPrefix: [],
      syncEnabled: false,
    },
    settings,
  );
}

it("removes a bookmark and its menu and shortcut references before notifying readers", () => {
  const state = createState();
  const seen: boolean[] = [];
  state.subscribe(["bookmarks", "menus", "shortcuts"], () => {
    seen.push(
      !state.settings.staticBookmarks.length &&
        state.settings.menus[0]!.items.every((item) => item.staticUid !== "static") &&
        state.settings.shortcuts[0]!.type === undefined &&
        state.settings.nativeShortcuts[0]!.type === undefined,
    );
  });
  state.removeBookmark("static", "static");
  expect(seen).toEqual([true]);
  expect(state.settings.menus[0]!.items.map((item) => item.uid)).toEqual(["other-item"]);
  expect(state.settings.shortcuts[0]!.tabMode).toBe("newTab");
  expect(state.settings.nativeShortcuts[0]!.key).toBe("Ctrl+A");
  expect(state.dirty.settings).toBe(true);
});

it("removes URL rule references from the global selection, menus and dynamic bookmarks", () => {
  const state = createState();
  state.removeUrlRule("removed-rule");
  expect(state.settings.defaultUrlRuleUid).toBeUndefined();
  expect(state.settings.menus[0]!.urlRuleUids).toEqual(["kept-rule"]);
  expect(state.settings.dynamicBookmarks[0]!.urlRuleUid).toBeUndefined();
  expect(state.settings.urlRules.map((rule) => rule.uid)).toEqual(["kept-rule"]);
});

it("keeps caller-owned data and returned snapshots from mutating drafts or another instance", () => {
  const input = initialSettings();
  const state = createState(input);
  const other = createState(input);
  input.staticBookmarks[0]!.name = "Changed outside";
  const item = { uid: "new", type: "bookmark", path: ["Original"] };
  state.addMenuItem("menu", item);
  item.path[0] = "Changed outside";
  expect(Reflect.set(state.settings.staticBookmarks[0]!, "name", "Changed snapshot")).toBe(false);
  expect(state.settings.staticBookmarks[0]!.name).toBe("Static");
  expect(state.settings.menus[0]!.items.at(-1)!.path).toEqual(["Original"]);
  expect(other.settings.menus[0]!.items).toHaveLength(2);
});

it("rejects missing targets without altering drafts and stops notifications after unsubscribe", () => {
  const state = createState();
  const names: string[] = [];
  const unsubscribe = state.subscribe(["bookmarks"], () =>
    names.push(state.settings.staticBookmarks[0]!.name),
  );
  expect(() => state.renameBookmark("static", "missing", "Name")).toThrow();
  expect(state.dirty.settings).toBe(false);
  state.renameBookmark("static", "static", "First");
  unsubscribe();
  state.renameBookmark("static", "static", "Second");
  expect(names).toEqual(["First"]);
});

it("resets a cleared menu color to the default instead of leaving the menu uncolored", async () => {
  const { DEFAULT_MENU_COLOR } = await import("@browserail/protocol");
  const state = createState();
  state.setColor({ kind: "menu", uid: "menu", field: "color" }, "#123456ff");
  state.setColor({ kind: "menu", uid: "menu", field: "color" }, undefined);
  expect(state.settings.menus[0]!.color).toBe(DEFAULT_MENU_COLOR);
});


it("keeps code when switching update modes and clears a removed single-rule selection", () => {
  const state = createState();
  state.setDynamicCode("dynamic", "function dynamicBookmark() { return { newUrl: null }; }");
  state.setDynamicType("dynamic", "rule");
  state.setDynamicRule("dynamic", "removed-rule");
  state.removeUrlRule("removed-rule");
  expect(state.settings.dynamicBookmarks[0]).toMatchObject({ type: "rule", code: "function dynamicBookmark() { return { newUrl: null }; }" });
  expect(state.settings.dynamicBookmarks[0]!.urlRuleUid).toBeUndefined();
  state.setDynamicType("dynamic", "code");
  expect(state.settings.dynamicBookmarks[0]!.code).toBe("function dynamicBookmark() { return { newUrl: null }; }");
});
