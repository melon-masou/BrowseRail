export interface TabActionBrowser {
  bookmarks: {
    get(id: string): Promise<Array<{ url?: string }>>;
  };
  tabs: {
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
  const windowId = Number(windowUid);
  if (!Number.isInteger(windowId)) {
    throw new Error("The bound browser window is invalid");
  }

  const bookmarkId = parseBookmarkAction(actionUid);
  await api.windows.get(windowId);

  const [bookmark] = await api.bookmarks.get(bookmarkId);
  if (!bookmark?.url) {
    throw new Error("The bookmark no longer exists");
  }

  const [tab] = await api.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) {
    throw new Error("The bound browser window has no active tab");
  }

  await api.tabs.update(tab.id, { url: bookmark.url });
}

function parseBookmarkAction(actionUid: string): string {
  const prefix = "bookmark:";
  if (!actionUid.startsWith(prefix)) {
    throw new Error("The action is not a bookmark navigation");
  }

  return decodeURIComponent(actionUid.slice(prefix.length));
}

