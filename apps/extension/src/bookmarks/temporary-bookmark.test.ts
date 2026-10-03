import { beforeEach, expect, it, vi } from "vitest";

let storage: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
      },
    },
    bookmarks: { getTree: vi.fn() },
  },
}));

import { buildTemporaryDirectiveUrl, resolveMenuItems } from "./index";
import { loadConfig, loadTemporaryNotes, loadTemporaryValues, pruneTemporaryValues, saveConfig, saveTemporaryValue, clearTemporaryValue, normalizeMenu } from "../config";
import { captureTemporaryUrl } from "../background/temporary";

beforeEach(() => { storage = {}; });

it("keeps a temporary URL across a fresh storage read and resolves it without a browser bookmark", async () => {
  await saveTemporaryValue("slot-one", "https://example.com/first", "Read later");
  const reloadedValues = await loadTemporaryValues();
  const reloadedNotes = await loadTemporaryNotes();
  const [entry] = await resolveMenuItems(
    [{ uid: "button-one", type: "temporary", temporaryUid: "slot-one", rename: "Later" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { temporaryNotes: reloadedNotes, temporaryBookmarks: [{ uid: "slot-one", name: "Later" }] },
  );

  expect(entry).toMatchObject({
    kind: "bookmark",
    label: "Read later",
  });
  expect(reloadedValues["slot-one"]).toBe("https://example.com/first");
  expect(JSON.stringify(entry)).not.toContain("https://example.com/first");
});

it("requires confirmation before both the first save and replacement", async () => {
  const definitions = [{ uid: "slot", name: "Later" }];
  const tabs = { query: vi.fn(async () => [{ url: "https://example.com/first" }]) };

  expect(await captureTemporaryUrl(tabs, definitions, "slot", "12", false)).toBe("needsConfirmation");
  expect((await loadTemporaryValues()).slot).toBeUndefined();

  expect(await captureTemporaryUrl(tabs, definitions, "slot", "12", true, "First note")).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/first");
  expect((await loadTemporaryNotes()).slot).toBe("First note");

  tabs.query.mockResolvedValue([{ url: "https://example.com/second" }]);
  expect(await captureTemporaryUrl(tabs, definitions, "slot", "12", false)).toBe("needsConfirmation");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/first");

  expect(await captureTemporaryUrl(tabs, definitions, "slot", "12", true, "Second note")).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/second");
  expect((await loadTemporaryNotes()).slot).toBe("Second note");

  tabs.query.mockResolvedValue([{ url: "https://example.com/third" }]);
  expect(await captureTemporaryUrl(tabs, definitions, "slot", "12", true)).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/third");
  expect((await loadTemporaryNotes()).slot).toBeUndefined();
  const [entry] = await resolveMenuItems(
    [{ uid: "button", type: "temporary", temporaryUid: "slot", rename: "Fixed name" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { temporaryNotes: await loadTemporaryNotes(), temporaryBookmarks: definitions },
  );
  expect(entry).toMatchObject({ kind: "bookmark", label: "Fixed name" });
});

it("keeps a temporary value after removing its button and removes it only after deleting the definition", async () => {
  const config = await loadConfig();
  config.panel.menus = [{
    uid: "menu",
    orientation: "column",
    items: [
      { uid: "keep-button", type: "temporary", temporaryUid: "keep" },
      { uid: "remove-button", type: "temporary", temporaryUid: "remove" },
    ],
  }];
  config.temporaryBookmarks = [{ uid: "keep", name: "Keep" }, { uid: "remove", name: "Remove" }];
  await saveConfig(config);
  await saveTemporaryValue("keep", "https://example.com/keep", "Keep");
  await saveTemporaryValue("remove", "https://example.com/remove", "Remove");

  config.panel.menus[0]!.items.splice(1, 1);
  expect((await loadTemporaryValues()).remove).toBe("https://example.com/remove");

  await saveConfig(config);
  await pruneTemporaryValues(config.temporaryBookmarks);
  expect((await loadTemporaryValues()).remove).toBe("https://example.com/remove");
  config.temporaryBookmarks = config.temporaryBookmarks.filter(entry => entry.uid !== "remove");
  await saveConfig(config);
  await pruneTemporaryValues(config.temporaryBookmarks);
  expect(await loadTemporaryValues()).toEqual({ keep: "https://example.com/keep" });
  expect(await loadTemporaryNotes()).toEqual({ keep: "Keep" });
});

it("captures a defined slot even when it is not currently placed in a menu", async () => {
  const definitions = [{ uid: "tree-slot", name: "From Tree" }];
  const tabs = { query: vi.fn(async () => [{ url: "https://example.com/tree-page" }]) };

  expect(await captureTemporaryUrl(tabs, definitions, "tree-slot", "1", true, "From Tree")).toBe("saved");
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/tree-page");
  expect((await loadTemporaryNotes())["tree-slot"]).toBe("From Tree");

  await pruneTemporaryValues(definitions);
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/tree-page");
  expect((await loadTemporaryNotes())["tree-slot"]).toBe("From Tree");

  await pruneTemporaryValues([]);
  expect((await loadTemporaryValues())["tree-slot"]).toBeUndefined();
  expect((await loadTemporaryNotes())["tree-slot"]).toBeUndefined();
});

it("ignores a malformed temporary marker and keeps other temporary slots usable", async () => {
  const tree = [{
    id: "0",
    title: "",
    children: [{
      id: "folder-temp",
      title: "Temps",
      children: [
        { id: "broken", title: "Broken", url: "https://browserail.local/#Temporary:%" },
        { id: "valid", title: "Usable", url: buildTemporaryDirectiveUrl({ id: "tree-slot" }) },
      ],
    }],
  }];
  const tabs = { query: vi.fn(async () => [{ url: "https://example.com/usable" }]) };

  const definitions = [{ uid: "tree-slot", name: "Usable" }];
  expect(await captureTemporaryUrl(tabs, definitions, "tree-slot", "1", true, "Usable note")).toBe("saved");
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/usable");

  const entries = await resolveMenuItems(
    [{ uid: "flatten-temp", path: ["Temps"], type: "flattenFolder" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { tree, temporaryNotes: await loadTemporaryNotes(), temporaryBookmarks: definitions },
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ kind: "bookmark", label: "Usable note" });
});

it("clears a slot's URL and note together without changing another slot", async () => {
  await saveTemporaryValue("clear", "https://example.com/clear", "Clear");
  await saveTemporaryValue("keep", "https://example.com/keep", "Keep");
  await clearTemporaryValue("clear");
  expect(await loadTemporaryValues()).toEqual({ keep: "https://example.com/keep" });
  expect(await loadTemporaryNotes()).toEqual({ keep: "Keep" });
});

it("does not migrate an old inline temporary button or authorize an undefined slot", async () => {
  const menu = normalizeMenu({ uid: "menu", orientation: "row", items: [{ uid: "old", type: "temporary" }] });
  expect(menu?.items).toEqual([]);
  const tabs = { query: vi.fn(async () => [{ url: "https://example.com" }]) };
  expect(await captureTemporaryUrl(tabs, [], "old", "1", true)).toBe("unavailable");
  expect(await loadTemporaryValues()).toEqual({});
});
