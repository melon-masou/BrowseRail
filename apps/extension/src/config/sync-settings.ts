import browser from "webextension-polyfill";

export interface WebDavSettings { url: string; username: string; password: string }
export interface SyncSettings { provider: "chrome" | "webdav"; webdav: WebDavSettings }
const KEY = "sync_settings";

export async function loadSyncSettings(): Promise<SyncSettings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<SyncSettings> | undefined;
  return {
    provider: stored?.provider === "webdav" ? "webdav" : "chrome",
    webdav: {
      url: typeof stored?.webdav?.url === "string" ? stored.webdav.url : "",
      username: typeof stored?.webdav?.username === "string" ? stored.webdav.username : "",
      password: typeof stored?.webdav?.password === "string" ? stored.webdav.password : "",
    },
  };
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settings });
}
