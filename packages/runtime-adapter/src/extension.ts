import type browser from "webextension-polyfill";
import type { RuntimeAdapter } from "./contracts";

export function createExtensionRuntimeAdapter(api: typeof browser): RuntimeAdapter {
  let bookmarksAvailable: Promise<boolean> | undefined;
  async function detectBookmarks(): Promise<boolean> {
    if (typeof api.bookmarks?.getTree !== "function") return false;
    try { await api.bookmarks.getTree(); return true; }
    catch { return false; }
  }
  return {
    get storage() { return api.storage; },
    bookmarks: {
      isAvailable: () => bookmarksAvailable ??= detectBookmarks(),
      getTree: () => api.bookmarks.getTree(),
      get: id => api.bookmarks.get(id),
      create: details => api.bookmarks.create(details),
    },
    get navigation() { return api.tabs; },
    messaging: {
      get id() { return api.runtime.id; },
      send: message => api.runtime.sendMessage(message),
      sendToTab: (tabId, message, options) => api.tabs.sendMessage(tabId, message, options),
      sendToExtension: (extensionId, message) => api.runtime.sendMessage(extensionId, message),
      get onMessage() { return api.runtime.onMessage; },
    },
    get permissions() { return api.permissions; },
    capabilities: {
      get browserBookmarks() { return typeof api.bookmarks?.getTree === "function"; },
      get browserSync() { return Boolean(api.storage.sync); },
      get websitePermissions() { return typeof api.permissions?.request === "function"; },
      get browserShortcuts() { return typeof api.commands?.getAll === "function"; },
      externalExtensions: true,
      desktopConnection: true,
    },
    resourceUrl: path => api.runtime.getURL(path),
    platformInfo: () => api.runtime.getPlatformInfo(),
  };
}

// Extension lifecycle and UI APIs stay outside the portable runtime contract.
export interface ExtensionServices {
  readonly windows: typeof browser.windows;
  readonly tabEvents: Pick<typeof browser.tabs, "onActivated" | "onUpdated" | "onReplaced" | "onAttached" | "onDetached" | "onRemoved">;
  readonly bookmarkEvents: Pick<typeof browser.bookmarks, "onCreated" | "onChanged" | "onMoved" | "onRemoved">;
  readonly permissionEvents: Pick<typeof browser.permissions, "onAdded" | "onRemoved">;
  readonly commands: typeof browser.commands;
  readonly scripting: typeof browser.scripting;
  readonly action: typeof browser.action;
  readonly contextMenus: typeof browser.contextMenus;
  readonly runtime: Pick<typeof browser.runtime, "onMessageExternal" | "lastError" | "openOptionsPage">;
}

export function createExtensionServices(api: typeof browser): ExtensionServices {
  return {
    get windows() { return api.windows; },
    get tabEvents() { return api.tabs; },
    get bookmarkEvents() { return api.bookmarks; },
    get permissionEvents() { return api.permissions; },
    get commands() { return api.commands; },
    get scripting() { return api.scripting; },
    get action() { return api.action; },
    get contextMenus() { return api.contextMenus; },
    get runtime() { return api.runtime; },
  };
}

export interface OffscreenService {
  hasDocument?(): Promise<boolean>;
  closeDocument?(): Promise<void>;
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

interface ChromeServices {
  offscreen?: OffscreenService;
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: { addListener(listener: (message: unknown, sender: { id?: string; tab?: unknown }, respond: (response: unknown) => void) => boolean | undefined): void };
  };
}

export function offscreenService(): OffscreenService | undefined {
  return (globalThis as typeof globalThis & { chrome?: ChromeServices }).chrome?.offscreen;
}

export function offscreenResourceUrl(path: string): string {
  return (globalThis as typeof globalThis & { chrome: ChromeServices }).chrome.runtime.getURL(path);
}

// Chrome's offscreen listener must keep the response channel open until the worker replies.
export function listenOffscreenRequests(handle: (message: unknown) => Promise<unknown> | undefined): void {
  const api = (globalThis as typeof globalThis & { chrome: ChromeServices }).chrome;
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== api.runtime.id || sender.tab) return;
    const reply = handle(message);
    if (!reply) return;
    void reply.then(respond);
    return true;
  });
}
