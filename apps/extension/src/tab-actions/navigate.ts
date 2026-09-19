export type TabMode = "replace" | "newTab";

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

export interface ParsedBookmarkAction {
  bookmarkId: string;
  tabMode: TabMode;
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

export function parseBookmarkAction(actionUid: string): ParsedBookmarkAction {
  const prefix = "bookmark:";
  if (!actionUid.startsWith(prefix)) {
    throw new Error("The action is not a bookmark navigation");
  }

  const raw = actionUid.slice(prefix.length);
  const qIndex = raw.indexOf("?tab=");
  if (qIndex !== -1) {
    const bookmarkId = decodeURIComponent(raw.slice(0, qIndex));
    const mode = raw.slice(qIndex + 5);
    return {
      bookmarkId,
      tabMode: mode === "newTab" ? "newTab" : "replace",
    };
  }

  return {
    bookmarkId: decodeURIComponent(raw),
    tabMode: "replace",
  };
}

