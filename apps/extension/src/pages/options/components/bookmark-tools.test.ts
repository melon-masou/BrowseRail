import { expect, it, vi } from "vitest";
import type { BookmarkNode } from "../../../lib/bookmarks";

vi.mock("webextension-polyfill", () => ({ default: {} }));

const folder: BookmarkNode = {
  id: "folder", title: "Folder", children: [
    { id: "a", title: "Docs", url: "https://docs.example/" },
    { id: "b", title: "", url: "https://untitled.example/" },
    { id: "c", title: "Smart", url: "place:sort=8" },
    { id: "d", title: "Docs again", url: "https://docs.example/" },
    { id: "e", title: "Known", url: "https://known.example/" },
    { id: "sub", title: "Sub", children: [{ id: "f", title: "Nested", url: "https://nested.example/" }] },
  ],
};

it("imports a folder's bookmarks as static bookmarks, nesting only when asked and skipping duplicates", async () => {
  const { staticBookmarksFromFolder } = await import("./bookmark-tools");
  const flat = staticBookmarksFromFolder(folder, false, ["https://known.example/"]);
  expect(flat.added.map(bookmark => [bookmark.name, bookmark.url])).toEqual([
    ["Docs", "https://docs.example/"],
    // Untitled bookmarks stay recognizable by their URL.
    ["https://untitled.example/", "https://untitled.example/"],
  ]);
  expect(flat.skipped).toBe(2);
  expect(new Set(flat.added.map(bookmark => bookmark.uid)).size).toBe(flat.added.length);

  const nested = staticBookmarksFromFolder(folder, true, [], ["Work"]);
  expect(nested.added.map(bookmark => bookmark.url)).toEqual([
    "https://docs.example/", "https://untitled.example/", "https://known.example/", "https://nested.example/",
  ]);
  // The tag chosen at import time lands on every imported bookmark.
  expect(nested.added.every(bookmark => bookmark.tags?.join() === "Work")).toBe(true);
  expect(flat.added.every(bookmark => bookmark.tags === undefined)).toBe(true);
});
