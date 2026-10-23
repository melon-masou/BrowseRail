import { runtime, extension } from "../../runtime";

const STORAGE_KEY = "browser_bar_edit_session";
interface Owner { tabId: number; menuUid: string; token: string }

export function createBrowserEditSession() {
  let pending = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(() => {}, () => {});
    return result;
  }
  async function owner(): Promise<Owner | undefined> {
    const stored = await runtime.storage.session.get(STORAGE_KEY);
    return stored[STORAGE_KEY] as Owner | undefined;
  }
  const releaseTab = (tabId: number): Promise<void> => serialized(async () => {
    if ((await owner())?.tabId === tabId) await runtime.storage.session.remove(STORAGE_KEY);
  });
  extension.tabEvents.onRemoved.addListener(tabId => { void releaseTab(tabId); });
  extension.tabEvents.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") void releaseTab(tabId);
  });
  return {
    begin(tabId: number, menuUid: string, token: string): Promise<boolean> {
      return serialized(async () => {
        if (await owner()) return false;
        await runtime.storage.session.set({ [STORAGE_KEY]: { tabId, menuUid, token } satisfies Owner });
        return true;
      });
    },
    async owns(tabId: number, menuUid: string, token: string): Promise<boolean> {
      const active = await owner();
      return active?.tabId === tabId && active.menuUid === menuUid && active.token === token;
    },
    end(tabId: number, token: string): Promise<void> {
      return serialized(async () => {
        const active = await owner();
        if (active?.tabId === tabId && active.token === token) await runtime.storage.session.remove(STORAGE_KEY);
      });
    },
    clear(): Promise<void> { return serialized(() => runtime.storage.session.remove(STORAGE_KEY)); },
  };
}
