import { expect, it } from "vitest";
import { defaultBarSettings, EXPORT_SCHEMA_VERSION, type ExportedSettingsData } from "@browserail/protocol";
import { mergeTransferData, selectTransferData, transferCounts } from "./transfer";

const remote: ExportedSettingsData = {
  version: EXPORT_SCHEMA_VERSION, exportedAt: "2026-10-08T00:00:00Z",
  menus: [{ uid: "old", items: [] }], globalCss: { theme: "old CSS" },
  urlRules: [{ uid: "old-rule", name: "Old rule", patterns: ["example.com"] }], defaultUrlRuleUid: "old-rule",
  staticBookmarks: [{ uid: "old-link", name: "Old link", url: "https://example.com" }],
  userVariables: { old: "value" },
  shortcuts: [{ slot: "slot_1", type: "static", staticUid: "old-link" }],
  barConfigurations: { native: {}, browser: { old: { ...defaultBarSettings(), placement: { boundPosition: { anchor: "topLeft", offsetX: 12, offsetY: 12 }, itemWidth: 100, itemHeight: 30 }, gapRatio: .2, extraGaps: {} } } },
};
const local: ExportedSettingsData = { version: EXPORT_SCHEMA_VERSION, exportedAt: "2026-10-09T00:00:00Z", menus: [{ uid: "new", items: [] }], globalCss: { theme: "new CSS" }, urlRules: [], staticBookmarks: [], userVariables: {} };

it("replaces the selected remote category and preserves every unselected category", () => {
  const merged = mergeTransferData(remote, local, { menus: true, urlRules: false, bookmarks: false, shortcuts: false, bars: false });
  expect(merged).toEqual({ ...remote, exportedAt: local.exportedAt, menus: local.menus, globalCss: local.globalCss });
  expect(remote.globalCss).toEqual({ theme: "old CSS" });
});

it("clears removed optional values within selected categories and initializes only selected categories on first upload", () => {
  const selection = { menus: false, urlRules: true, bookmarks: true, shortcuts: false, bars: false };
  const merged = mergeTransferData(remote, local, selection);
  expect(merged).not.toHaveProperty("defaultUrlRuleUid");
  expect(merged).toMatchObject({ urlRules: [], staticBookmarks: [], userVariables: {}, menus: remote.menus });
  expect(mergeTransferData(undefined, local, selection)).toEqual(selectTransferData(local, selection));
});

it("counts individual Native keys and both modes' saved layouts", () => {
  const data = { ...remote, nativeShortcutSets: [{ uid: "set", name: "Set", shortcuts: [{ id: "one", key: "c", type: "browserAction" as const, browserAction: "back" as const }, { id: "two", key: "r", type: "browserAction" as const, browserAction: "reload" as const }] }] };
  expect(transferCounts(data)).toEqual({ menus: 1, urlRules: 1, bookmarks: 1, shortcuts: 3, bars: 1 });
});
