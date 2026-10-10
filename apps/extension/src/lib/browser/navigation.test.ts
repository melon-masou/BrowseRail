import { describe, expect, it, vi } from "vitest";

import { navigateBookmark, type TabActionBrowser } from "./navigation";

function createBrowser(): TabActionBrowser {
  return {
    bookmarks: {
      get: vi.fn(async (id: string) => [{ id, url: "https://example.com" }]),
    },
    tabs: {
      create: vi.fn(async () => ({ id: 99 })),
      query: vi.fn(async () => [{ id: 17 }]),
      update: vi.fn(async () => undefined),
    },
  };
}

describe("navigateBookmark", () => {
  it("navigates the active tab in the bound window", async () => {
    const api = createBrowser();
    const bookmarkId = "bookmark-1";

    await navigateBookmark(api, "42", `bookmark:${bookmarkId}`);

    expect(api.bookmarks.get).toHaveBeenCalledWith("bookmark-1");
    expect(api.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 42 });
    expect(api.tabs.update).toHaveBeenCalledWith(17, { url: "https://example.com" });
  });

  it("opens a new tab when tabMode is newTab", async () => {
    const api = createBrowser();
    const bookmarkId = "bookmark-1";

    await navigateBookmark(api, "42", `bookmark:${bookmarkId}?tab=newTab`);

    expect(api.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "https://example.com",
      windowId: 42,
    });
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it("falls back to creating a tab when bound window has no active tab", async () => {
    const api = createBrowser();
    const bookmarkId = "bookmark-1";
    vi.mocked(api.tabs.query).mockResolvedValue([]);

    await navigateBookmark(api, "42", `bookmark:${bookmarkId}`);
    expect(api.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "https://example.com",
      windowId: 42,
    });
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it("rejects folder actions", async () => {
    const api = createBrowser();

    await expect(navigateBookmark(api, "42", "folder:folder-1")).rejects.toThrow(
      "not a bookmark",
    );
    expect(api.tabs.query).not.toHaveBeenCalled();
  });

  it("rejects a deleted bookmark", async () => {
    const api = createBrowser();

    vi.mocked(api.bookmarks.get).mockResolvedValue([]);
    await expect(navigateBookmark(api, "42", "bookmark:missing")).rejects.toThrow(
      "no longer exists",
    );
    expect(api.tabs.query).not.toHaveBeenCalled();
  });

  it("opens the requested bookmark after the navigation module is initialized again, without a saved UID mapping", async () => {
    const api = createBrowser();
    await navigateBookmark(api, "42", "bookmark:bookmark-1");
    vi.resetModules();
    const { navigateBookmark: afterRestart } = await import("./navigation");
    await afterRestart(api, "42", "bookmark:bookmark-1");
    expect(api.bookmarks.get).toHaveBeenLastCalledWith("bookmark-1");
    expect(api.tabs.update).toHaveBeenCalledTimes(2);
  });
});
