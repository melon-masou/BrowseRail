import type browser from "webextension-polyfill";
import type { RuntimeAdapter, RuntimeHost, ConfirmationSource, BrowserWindowCandidate, RewriteResult } from "./contracts";
import { createRewriteHost } from "./rewrite";

export const BROWSER_WINDOW_FILTER: browser.Windows.GetAllGetInfoType = {
  windowTypes: ["normal", "app"], populate: true,
};

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
    async resourceJson(path) {
      const response = await fetch(api.runtime.getURL(path));
      if (!response.ok) throw new Error(`Unable to load resource: ${path}`);
      return response.json();
    },
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

const REWRITE_RUN = "runRewrite";

export function isRewriteRun(value: unknown): value is { type: typeof REWRITE_RUN; source: string; url: string } {
  return value !== null && typeof value === "object" && "type" in value && value.type === REWRITE_RUN
    && "source" in value && typeof value.source === "string" && "url" in value && typeof value.url === "string";
}

export function createExtensionRewrite(runtime: RuntimeAdapter, runDirect: (source: string, url: string) => RewriteResult | Promise<RewriteResult>): RuntimeHost["runRewrite"] {
  let offscreenReady: Promise<void> | undefined;
  let rewriteHost: ReturnType<typeof createRewriteHost> | undefined;

  async function ensureOffscreen(): Promise<void> {
    const offscreen = offscreenService();
    if (!offscreen) throw new Error("Dynamic bookmark host unavailable");
    if (await offscreen.hasDocument?.()) return;
    offscreenReady ??= offscreen.createDocument({
      url: "offscreen.html", reasons: ["WORKERS"], justification: "Run URL rewrite workers.",
    }).catch(async error => {
      offscreenReady = undefined;
      if (!await offscreen.hasDocument?.()) throw error;
    });
    await offscreenReady;
  }

  return async (source, url) => {
    try {
      if (typeof document !== "undefined") {
        rewriteHost ??= createRewriteHost(runtime.resourceUrl("rewrite-worker.js"));
        return await rewriteHost.run(source, url);
      }
      if (typeof offscreenService()?.createDocument !== "function") return await runDirect(source, url);
      await ensureOffscreen();
      // The offscreen listener may not be ready when its document has just opened.
      const result = await runtime.messaging.send({ type: REWRITE_RUN, source, url }) as RewriteResult | undefined;
      if (typeof result?.ok === "boolean") return result;
      return { ok: false, error: "No rewrite response" };
    } catch (error) { return { ok: false, error: String(error) }; }
  };
}

export function createExtensionHost(runtime: RuntimeAdapter, extension: ExtensionServices, runRewrite: RuntimeHost["runRewrite"]): RuntimeHost {
  async function openConfirmation(source: ConfirmationSource, fields: Record<string, string>): Promise<"opened" | "prompt"> {
    if (!extension.action?.openPopup || !extension.action?.setPopup) return "prompt";
    const query = new URLSearchParams({
      ...fields,
      sourceTabId: String(source.sourceTabId), sourceWindowId: String(source.sourceWindowId),
    });
    let opened = false;
    try {
      try {
        await extension.action.setPopup({ tabId: source.sourceTabId, popup: `${runtime.resourceUrl("temporary-confirm.html")}?${query}` });
        await extension.action.openPopup({ windowId: source.sourceWindowId });
        opened = true;
      } finally {
        // Clearing the entry affects future icon clicks, not the open document.
        await extension.action.setPopup({ tabId: source.sourceTabId, popup: "" });
      }
    } catch (error) {
      if (opened) throw error;
      return "prompt";
    }
    return "opened";
  }

  return {
    browserKind: () => browserKind(runtime),
    listWindows: () => listBrowserWindows(runtime, extension),
    commands: () => extension.commands.getAll(),
    async openShortcutSettings(): Promise<void> {
      const kind = browserKind(runtime);
      if (kind === "firefox") {
        const commands = extension.commands as typeof extension.commands & { openShortcutSettings(): Promise<void> };
        await commands.openShortcutSettings();
        return;
      }
      await runtime.navigation.create({ url: kind === "edge" ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts" });
    },
    onPermissionsChanged(listener) {
      extension.permissionEvents.onAdded.addListener(listener);
      extension.permissionEvents.onRemoved.addListener(listener);
      return () => {
        extension.permissionEvents.onAdded.removeListener(listener);
        extension.permissionEvents.onRemoved.removeListener(listener);
      };
    },
    onTabRemoved(listener) {
      extension.tabEvents?.onRemoved?.addListener(listener);
      return () => extension.tabEvents?.onRemoved?.removeListener(listener);
    },
    onTabUpdated(listener) {
      extension.tabEvents?.onUpdated?.addListener(listener);
      return () => extension.tabEvents?.onUpdated?.removeListener(listener);
    },
    openConfirmation,
    runRewrite,
  };
}

// Best-effort browser identification for display only (see BrowserKind). The
// returned value is a plain string with a "chrome" fallback; it is never used
// for matching, so callers must not switch on an enumerated set.
function browserKind(runtime: RuntimeAdapter): string {
  if (runtime.resourceUrl("").startsWith("moz-extension:")) {
    return "firefox";
  }

  const userAgent = navigator.userAgent;
  if (/\bEdg\//.test(userAgent)) {
    return "edge";
  }
  if (/\bOPR\//.test(userAgent)) {
    return "opera";
  }
  if (/\bVivaldi\//.test(userAgent)) {
    return "vivaldi";
  }
  if (
    "brave" in navigator &&
    typeof (navigator as Navigator & { brave?: unknown }).brave === "object"
  ) {
    return "brave";
  }
  return "chrome";
}

async function listBrowserWindows(runtime: RuntimeAdapter, extension: ExtensionServices): Promise<BrowserWindowCandidate[]> {
  const [windows, activeTabs] = await Promise.all([
    extension.windows.getAll(BROWSER_WINDOW_FILTER),
    runtime.navigation.query({ active: true }).catch(() => []),
  ]);

  const activeTabMap = new Map<number, string>();
  for (const tab of activeTabs) {
    if (tab.windowId !== undefined) {
      const url = tab.url || (tab as { pendingUrl?: string }).pendingUrl;
      if (url) {
        activeTabMap.set(tab.windowId, url);
      }
    }
  }

  return windows.flatMap((window) => {
    if (
      window.id === undefined ||
      window.left === undefined ||
      window.top === undefined ||
      window.width === undefined ||
      window.height === undefined
    ) {
      return [];
    }

    const activeTab = window.tabs?.find((tab) => tab.active);
    const activeTabUrl =
      (window.id !== undefined ? activeTabMap.get(window.id) : undefined) ||
      activeTab?.url ||
      (activeTab as { pendingUrl?: string } | undefined)?.pendingUrl;

    return [
      {
        uid: String(window.id),
        focused: window.focused ?? false,
        ...(activeTabUrl !== undefined ? { activeTabUrl } : {}),
        bounds: {
          x: window.left,
          y: window.top,
          width: window.width,
          height: window.height,
        },
      },
    ];
  });
}
