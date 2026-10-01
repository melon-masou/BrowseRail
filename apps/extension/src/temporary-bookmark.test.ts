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

import { buildTemporaryDirectiveUrl, resolveMenuItems } from "./bookmarks";
import { loadConfig, loadTemporaryNotes, loadTemporaryValues, pruneTemporaryValues, saveConfig, saveTemporaryValue } from "./config";
import { captureTemporaryUrl } from "./background/temporary";

beforeEach(() => { storage = {}; });

it("keeps a temporary URL across a fresh storage read and resolves it without a browser bookmark", async () => {
  await saveTemporaryValue("slot-one", "https://example.com/first", "Read later");
  const reloadedValues = await loadTemporaryValues();
  const reloadedNotes = await loadTemporaryNotes();
  const [entry] = await resolveMenuItems(
    [{ uid: "slot-one", type: "temporary", rename: "Later" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { temporaryNotes: reloadedNotes },
  );

  expect(entry).toMatchObject({
    kind: "bookmark",
    label: "Read later",
  });
  expect(reloadedValues["slot-one"]).toBe("https://example.com/first");
  expect(JSON.stringify(entry)).not.toContain("https://example.com/first");
});

it("requires confirmation before both the first save and replacement", async () => {
  const menus = [{ uid: "menu", orientation: "column" as const, items: [{ uid: "slot", type: "temporary" }] }];
  const tabs = { query: vi.fn(async () => [{ url: "https://example.com/first" }]) };

  expect(await captureTemporaryUrl(tabs, menus, "slot", "12", false)).toBe("needsConfirmation");
  expect((await loadTemporaryValues()).slot).toBeUndefined();

  expect(await captureTemporaryUrl(tabs, menus, "slot", "12", true, "First note")).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/first");
  expect((await loadTemporaryNotes()).slot).toBe("First note");

  tabs.query.mockResolvedValue([{ url: "https://example.com/second" }]);
  expect(await captureTemporaryUrl(tabs, menus, "slot", "12", false)).toBe("needsConfirmation");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/first");

  expect(await captureTemporaryUrl(tabs, menus, "slot", "12", true, "Second note")).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/second");
  expect((await loadTemporaryNotes()).slot).toBe("Second note");

  tabs.query.mockResolvedValue([{ url: "https://example.com/third" }]);
  expect(await captureTemporaryUrl(tabs, menus, "slot", "12", true)).toBe("saved");
  expect((await loadTemporaryValues()).slot).toBe("https://example.com/third");
  expect((await loadTemporaryNotes()).slot).toBeUndefined();
  const [entry] = await resolveMenuItems(
    [{ uid: "slot", type: "temporary", rename: "Fixed name" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { temporaryNotes: await loadTemporaryNotes() },
  );
  expect(entry).toMatchObject({ kind: "bookmark", label: "Fixed name" });
});

it("removes a deleted temporary bookmark's URL after its menu changes are saved", async () => {
  const config = await loadConfig();
  config.panel.menus = [{
    uid: "menu",
    orientation: "column",
    items: [
      { uid: "keep", type: "temporary" },
      { uid: "remove", type: "temporary" },
    ],
  }];
  await saveConfig(config);
  await saveTemporaryValue("keep", "https://example.com/keep", "Keep");
  await saveTemporaryValue("remove", "https://example.com/remove", "Remove");

  config.panel.menus[0]!.items.splice(1, 1);
  expect((await loadTemporaryValues()).remove).toBe("https://example.com/remove");

  await saveConfig(config);
  await pruneTemporaryValues(config.panel.menus);
  expect(await loadTemporaryValues()).toEqual({ keep: "https://example.com/keep" });
  expect(await loadTemporaryNotes()).toEqual({ keep: "Keep" });
});

it("captures and preserves temporary bookmarks originating from bookmark tree folders", async () => {
  const tree = [
    {
      id: "0",
      title: "",
      children: [
        {
          id: "folder-temp",
          title: "MyFolder",
          children: [
            { id: "bm-temp", title: "Temp Slot", url: buildTemporaryDirectiveUrl({ id: "tree-slot" }) },
          ],
        },
      ],
    },
  ] as any;

  const tabs = { query: vi.fn(async () => [{ url: "https://example.com/tree-page" }]) };

  // captureTemporaryUrl succeeds because the uid is in the bookmark tree
  expect(await captureTemporaryUrl(tabs, [], "tree-slot", "1", true, "From Tree", tree)).toBe("saved");
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/tree-page");
  expect((await loadTemporaryNotes())["tree-slot"]).toBe("From Tree");

  // pruneTemporaryValues retains tree-slot because it exists in bookmarkTree
  await pruneTemporaryValues([], tree);
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/tree-page");
  expect((await loadTemporaryNotes())["tree-slot"]).toBe("From Tree");

  // Without the bookmark tree, prune removes it
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

  expect(await captureTemporaryUrl(tabs, [], "tree-slot", "1", true, "Usable note", tree)).toBe("saved");
  expect((await loadTemporaryValues())["tree-slot"]).toBe("https://example.com/usable");

  const entries = await resolveMenuItems(
    [{ uid: "flatten-temp", path: ["Temps"], type: "flattenFolder" }],
    undefined,
    undefined,
    undefined,
    undefined,
    { tree, temporaryNotes: await loadTemporaryNotes() },
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ kind: "bookmark", label: "Usable note" });
});
