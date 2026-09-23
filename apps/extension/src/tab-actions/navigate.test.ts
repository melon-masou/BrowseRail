import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearBookmarkTargets, createBookmarkTargetDraft } from "../bookmark-registry";
import { navigateBookmark, type TabActionBrowser } from "./navigate";

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
    windows: { get: vi.fn(async () => ({})) },
  };
}

function registerTarget(browserBookmarkId: string): string {
  const draft = createBookmarkTargetDraft();
  const runtimeUid = draft.register(browserBookmarkId);
  draft.commit();
  return runtimeUid;
}

describe("navigateBookmark", () => {
  beforeEach(() => clearBookmarkTargets());

  it("navigates the active tab in the bound window", async () => {
    const api = createBrowser();
    const runtimeUid = registerTarget("bookmark-1");

    await navigateBookmark(api, "42", `bookmark:${runtimeUid}`);

    expect(api.bookmarks.get).toHaveBeenCalledWith("bookmark-1");
    expect(api.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 42 });
    expect(api.tabs.update).toHaveBeenCalledWith(17, { url: "https://example.com" });
  });

  it("opens a new tab when tabMode is newTab", async () => {
    const api = createBrowser();
    const runtimeUid = registerTarget("bookmark-1");

    await navigateBookmark(api, "42", `bookmark:${runtimeUid}?tab=newTab`);

    expect(api.tabs.create).toHaveBeenCalledWith({
      active: true,
      url: "https://example.com",
      windowId: 42,
    });
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it("falls back to creating a tab when bound window has no active tab", async () => {
    const api = createBrowser();
    const runtimeUid = registerTarget("bookmark-1");
    vi.mocked(api.tabs.query).mockResolvedValue([]);

    await navigateBookmark(api, "42", `bookmark:${runtimeUid}`);
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

  it("rejects an action whose bookmark target is no longer known", async () => {
    const api = createBrowser();

    await expect(navigateBookmark(api, "42", "bookmark:missing")).rejects.toThrow(
      "no longer exists",
    );
    expect(api.tabs.query).not.toHaveBeenCalled();
  });

  it("keeps runtime ids stable and accepts the previous sync generation during handoff", async () => {
    const firstDraft = createBookmarkTargetDraft();
    const firstUid = firstDraft.register("bookmark-1");
    firstDraft.commit();

    const secondDraft = createBookmarkTargetDraft();
    expect(secondDraft.register("bookmark-1")).toBe(firstUid);
    secondDraft.register("bookmark-2");
    secondDraft.commit();

    const thirdDraft = createBookmarkTargetDraft();
    thirdDraft.register("bookmark-2");
    thirdDraft.commit();

    const api = createBrowser();
    await navigateBookmark(api, "42", `bookmark:${firstUid}`);
    expect(api.bookmarks.get).toHaveBeenCalledWith("bookmark-1");
  });
});
