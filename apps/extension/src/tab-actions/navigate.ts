import {
  parseBookmarkAction,
  type ParsedBookmarkAction,
  type TabMode,
} from "@browserail/protocol";

export { parseBookmarkAction, type ParsedBookmarkAction, type TabMode };

export interface TabActionBrowser {
  bookmarks: {
    get(id: string): Promise<Array<{ url?: string }>>;
  };
  tabs: {
    create?(createProperties: { active?: boolean; url: string; windowId?: number }): Promise<unknown>;
    query(query: { active: true; windowId: number }): Promise<Array<{ id?: number }>>;
    update(tabId: number, update: { url: string }): Promise<unknown>;
  };
  windows: {
    get(windowId: number): Promise<unknown>;
  };
}

export async function navigateBookmark(
  api: TabActionBrowser,
  windowUid: string,
  actionUid: string,
): Promise<void> {
  if (actionUid.startsWith("noop")) {
    return;
  }

  const windowId = Number(windowUid);
  if (!Number.isInteger(windowId)) {
    throw new Error("The bound browser window is invalid");
  }

  const { bookmarkId, tabMode } = parseBookmarkAction(actionUid);
  await api.windows.get(windowId);

  const [bookmark] = await api.bookmarks.get(bookmarkId);
  if (!bookmark?.url) {
    throw new Error("The bookmark no longer exists");
  }

  if (tabMode === "newTab") {
    if (api.tabs.create) {
      await api.tabs.create({ active: true, url: bookmark.url, windowId });
      return;
    }
  }

  const [tab] = await api.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) {
    if (api.tabs.create) {
      await api.tabs.create({ active: true, url: bookmark.url, windowId });
      return;
    }
    throw new Error("The bound browser window has no active tab");
  }

  await api.tabs.update(tab.id, { url: bookmark.url });
}


