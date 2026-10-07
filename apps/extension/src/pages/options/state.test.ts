import { expect, it } from "vitest";
import { createOptionsState, type SettingsDraft } from "./state";

it("replaces bookmark and action targets without leaving old payloads or losing the Native key", () => {
  const state = createState();
  state.setShortcutTarget({ kind: "native", id: "native" }, { type: "menusToggle", targetMenuUids: ["menu"] });
  expect(state.settings.nativeShortcuts[0]).toEqual({ id: "native", key: "Ctrl+A", type: "menusToggle", targetMenuUids: ["menu"] });
  state.setShortcutTarget({ kind: "native", id: "native" }, { type: "browserAction", browserAction: "reload" });
  expect(state.settings.nativeShortcuts[0]).toEqual({ id: "native", key: "Ctrl+A", type: "browserAction", browserAction: "reload" });
  state.setShortcutTarget({ kind: "native", id: "native" }, { type: "static", uid: "static" });
  expect(state.settings.nativeShortcuts[0]).toEqual({ id: "native", key: "Ctrl+A", type: "static", staticUid: "static" });
});

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
    userVariables: {},
    temporaryBookmarks: [{ uid: "temporary", name: "Temporary" }],
    dynamicBookmarks: [
      { uid: "dynamic", name: "Dynamic", type: "external", urlRuleUid: "removed-rule" },
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
      externalAuthorization: { extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token: "" },
      rootPrefix: [],
      syncEnabled: false,
    },
    settings,
  );
}

it("discards draft external grants and token rotation without changing the saved userscript switch", () => {
  const state = createState();
  state.setUserscriptEnabled(true);
  state.setExternalExtensionsEnabled(true);
  state.setExternalExtensionIds("provider@example.com");
  const token = state.instance.externalAuthorization.token;
  expect(token).not.toBe("");
  expect(state.savedUserscriptEnabled).toBe(false);
  state.acceptInstanceSave(state.instance);
  expect(state.savedUserscriptEnabled).toBe(true);
  state.regenerateExternalToken();
  expect(state.instance.externalAuthorization.token).not.toBe(token);
  state.setUserscriptEnabled(false);
  state.setExternalExtensionsEnabled(false);
  state.discardInstance();
  expect(state.instance.externalAuthorization).toEqual({ extensionsEnabled: true, extensionIds: ["provider@example.com"], userscriptEnabled: true, token });
  expect(state.dirty.instance).toBe(false);
  expect(state.dirty.settings).toBe(false);
});

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

it("normalizes static tags and removes the last tag without leaving an empty tag value", () => {
  const state = createState();
  const tags = [" work ", "", "work", "reading"];
  state.setStaticTags("static", tags);
  tags.push("changed outside");
  expect(state.settings.staticBookmarks[0]!.tags).toEqual(["work", "reading"]);
  state.setStaticTags("static", []);
  expect(state.settings.staticBookmarks[0]!.tags ?? []).toEqual([]);
});

it("moves static bookmarks immediately before the target in the full list, retaining hidden entries and references", () => {
  const input = initialSettings();
  input.staticBookmarks = [
    { uid: "b", name: "B", url: "https://b.example", tags: ["work"] },
    { uid: "hidden", name: "Hidden", url: "https://hidden.example", tags: ["reading"] },
    { uid: "static", name: "A", url: "https://a.example", tags: ["work"] },
    { uid: "last", name: "Last", url: "https://last.example" },
  ];
  const state = createState(input);
  state.moveStaticBookmarkBefore("static", "b");
  expect(state.settings.staticBookmarks.map(bookmark => bookmark.uid)).toEqual(["static", "b", "hidden", "last"]);
  state.moveStaticBookmarkBefore("static", "last");
  expect(state.settings.staticBookmarks.map(bookmark => bookmark.uid)).toEqual(["b", "hidden", "static", "last"]);
  expect(state.settings.menus[0]!.items[0]!.staticUid).toBe("static");
  expect(state.settings.shortcuts[0]!.staticUid).toBe("static");
});

it("ignores unchanged static order and rejects missing reorder targets without removing the source", () => {
  const state = createState();
  state.addBookmark("static", { uid: "next", name: "Next", url: "https://next.example" });
  state.acceptSettingsSave(state.settings);
  state.moveStaticBookmarkBefore("static", "next");
  state.moveStaticBookmarkBefore("static", "static");
  expect(() => state.moveStaticBookmarkBefore("static", "missing")).toThrow();
  expect(() => state.setStaticTags("missing", ["work"])).toThrow();
  expect(state.settings.staticBookmarks.map(bookmark => bookmark.uid)).toEqual(["static", "next"]);
  expect(state.dirty.settings).toBe(false);
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


it("keeps rewrite rules when switching update modes and clears a removed single-rule selection", () => {
  const state = createState();
  state.setDynamicRewrite("dynamic", 'replace "/article/" "/reader/"');
  state.setDynamicType("dynamic", "rule");
  state.setDynamicRule("dynamic", "removed-rule");
  state.removeUrlRule("removed-rule");
  expect(state.settings.dynamicBookmarks[0]).toMatchObject({ type: "rule", rewrite: 'replace "/article/" "/reader/"' });
  expect(state.settings.dynamicBookmarks[0]!.urlRuleUid).toBeUndefined();
  state.setDynamicType("dynamic", "external");
  expect(state.settings.dynamicBookmarks[0]!.rewrite).toBe('replace "/article/" "/reader/"');
});

it.each(["staticTag", "flattenStaticTag"])("changes the tag source of %s without resetting its identity or settings", type => {
  const input = initialSettings();
  input.staticBookmarks[0]!.tags = ["new"];
  input.menus[0]!.items = [{ uid: "group", type, staticTag: "old", rename: "Links", color: "#123456ff", expandOnHover: false }];
  const state = createState(input);
  state.setStaticTagSource("menu", "group", "new");
  expect(state.settings.menus[0]!.items[0]).toEqual({ uid: "group", type, staticTag: "new", rename: "Links", color: "#123456ff", expandOnHover: false });
  expect(() => state.setStaticTagSource("menu", "group", "absent")).toThrow("unavailable");
  expect(state.settings.menus[0]!.items[0]!.staticTag).toBe("new");
  expect(state.dirty.settings).toBe(true);
});
