import {
  parseBookmarkAction,
  type ParsedBookmarkAction,
  type TabMode,
} from "@browserail/protocol";

import { resolveBookmarkTarget } from "../bookmark-registry";

export { parseBookmarkAction, type ParsedBookmarkAction, type TabMode };

export interface TabActionBrowser {
  bookmarks: {
    get(id: string): Promise<Array<{ id: string; url?: string }>>;
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

  const { uid, tabMode } = parseBookmarkAction(actionUid);
  const browserBookmarkId = resolveBookmarkTarget(uid);
  if (!browserBookmarkId) {
    throw new Error("The bookmark no longer exists");
  }
  const [bookmark] = await api.bookmarks.get(browserBookmarkId);
  const url = bookmark?.url;
  if (!url) {
    throw new Error("The bookmark no longer exists");
  }
  await navigateToUrl(api, windowId, url, tabMode);
}

// Navigate a target window to a URL, honoring tab mode. Shared by bookmark and
// dynamic-bookmark navigation.
export async function navigateToUrl(
  api: TabActionBrowser,
  windowUid: string | number,
  url: string,
  tabMode: TabMode,
): Promise<void> {
  const windowId = Number(windowUid);
  if (!Number.isInteger(windowId)) {
    throw new Error("The bound browser window is invalid");
  }
  await api.windows.get(windowId);

  if (tabMode === "newTab") {
    if (api.tabs.create) {
      await api.tabs.create({ active: true, url, windowId });
      return;
    }
  }

  const [tab] = await api.tabs.query({ active: true, windowId });
  if (tab?.id === undefined) {
    if (api.tabs.create) {
      await api.tabs.create({ active: true, url, windowId });
      return;
    }
    throw new Error("The bound browser window has no active tab");
  }

  await api.tabs.update(tab.id, { url });
}
