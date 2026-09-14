import { describe, expect, it, vi } from "vitest";

import { navigateBookmark, type TabActionBrowser } from "./navigate";

function createBrowser(): TabActionBrowser {
  return {
    bookmarks: { get: vi.fn(async () => [{ url: "https://example.com" }]) },
    tabs: {
      query: vi.fn(async () => [{ id: 17 }]),
      update: vi.fn(async () => undefined),
    },
    windows: { get: vi.fn(async () => ({})) },
  };
}

describe("navigateBookmark", () => {
  it("navigates the active tab in the bound window", async () => {
    const api = createBrowser();

    await navigateBookmark(api, "42", "bookmark:bookmark-1");

    expect(api.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 42 });
    expect(api.tabs.update).toHaveBeenCalledWith(17, { url: "https://example.com" });
  });

  it("does not fall back when the bound window has no active tab", async () => {
    const api = createBrowser();
    vi.mocked(api.tabs.query).mockResolvedValue([]);

    await expect(navigateBookmark(api, "42", "bookmark:bookmark-1")).rejects.toThrow(
      "no active tab",
    );
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it("rejects folder actions", async () => {
    const api = createBrowser();

    await expect(navigateBookmark(api, "42", "folder:folder-1")).rejects.toThrow(
      "not a bookmark",
    );
    expect(api.tabs.query).not.toHaveBeenCalled();
  });
});

