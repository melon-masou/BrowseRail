import { registerRuntimeAdapter, type RuntimeHost } from "@browserail/runtime-adapter";
import type { RuntimeAdapter, TabInfo } from "@browserail/runtime-adapter";
import { createUserscriptRuntimeAdapter, type UserscriptApi } from "@browserail/runtime-adapter/userscript";
import { onLanguageChange, t } from "@browserail/i18n";
import { mountBrowserMenu } from "@browserail/content/surface";
import menuStyles from "@browserail/menu-ui/styles.css?inline";
import hostStyles from "@browserail/content/styles.css?inline";
import closeButtonStyles from "@browserail/browserail/close-button.css?inline";
import { createBrowserMenus } from "@browserail/browserail/features/bar/menus";
import { createMenuSync } from "@browserail/browserail/features/sync/index";
import { createDebugLog } from "@browserail/browserail/features/desktop/debug-log";
import { createWindowFocus } from "@browserail/browserail/features/desktop/focus";
import { initDynamicBookmarks } from "@browserail/browserail/features/dynamic/updater";
import { createRewriteHost } from "@browserail/runtime-adapter/rewrite";
import {
  loadBrowserEditing, saveBrowserEditing, loadWidgetEnabled, saveWidgetEnabled,
  removeBrowserPlacement, loadConfig, saveConfig,
  BROWSER_EDITING_STORAGE_KEY, WIDGET_ENABLED_STORAGE_KEY,
} from "@browserail/browserail/lib/config/index";
import { CONFIG_SAVED, isConfigSaved } from "@browserail/browserail/lib/config/messages";
import { MENU_LAYOUT_RESET, isMenuLayoutReset } from "@browserail/browserail/features/bar/messages";
import { DESKTOP_STATE_REQUEST, WIDGET_ENABLED_SET, isDesktopRequest } from "@browserail/browserail/features/desktop/messages";
import { EDITING_SET, EDITING_STATE_CHANGED, isEditingRequest } from "@browserail/browserail/features/toolbar/messages";
import {
  USER_MENU_ITEMS, ENABLE_MENU_ID, EDIT_MENU_ID, ADD_STATIC_MENU_ID, OPTIONS_MENU_ID, type UserMenuId,
} from "@browserail/browserail/features/toolbar/user-menu";
import { BAR_COMMAND_MESSAGE, EXTERNAL_RUN_MESSAGE, isExternalRun, isBarRefresh, userscriptUpdateEvent, type BarCommand } from "@browserail/protocol/content";
import { MAX_EXTERNAL_MESSAGE_BYTES } from "@browserail/protocol/api";
import { createExternalUpdates } from "@browserail/browserail/features/api/updates";
import { loadExternalAuthorization } from "@browserail/browserail/lib/config/external-authorization-store";
import { EXTERNAL_AUTHORIZATION_STORAGE_KEY } from "@browserail/browserail/lib/config/external-authorization";
import { createUserscriptIcons } from "./icons";

declare const GM: UserscriptApi;
declare const __BROWSERAIL_RESOURCES__: Record<string, string>;
declare const __BROWSERAIL_REWRITE_WORKER__: string;
declare const __BROWSERAIL_SETTINGS__: (view: Window) => typeof import("./settings");

export async function startUserscript(adapter: RuntimeAdapter & { destroy(): Promise<void> }, api: UserscriptApi, workerSource: string) {
  const icons = await createUserscriptIcons(api, adapter.storage);
  adapter.iconResources = icons;
  const lifetime = new AbortController();
  const tabUpdates = new Set<(id: number, change: { url?: string }, tab: TabInfo) => void>();
  const tabRemovals = new Set<(id: number) => void>();
  let rewrite: ReturnType<typeof createRewriteHost> | undefined;
  let workerUrl: string | undefined;
  const unsupported = (): never => { throw new Error("This operation is unavailable in a userscript"); };
  const host: RuntimeHost = {
    browserKind: () => "userscript",
    listWindows: async () => [{ uid: "1", focused: document.hasFocus(), activeTabUrl: location.href,
      bounds: { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight } }],
    commands: async () => [], openShortcutSettings: unsupported,
    onPermissionsChanged: () => () => {},
    onTabUpdated(listener) { tabUpdates.add(listener); return () => { tabUpdates.delete(listener); }; },
    onTabRemoved(listener) { tabRemovals.add(listener); return () => { tabRemovals.delete(listener); }; },
    openConfirmation: async () => "prompt",
    runRewrite(source, url) {
      if (!rewrite) {
        workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        rewrite = createRewriteHost(workerUrl);
      }
      return rewrite.run(source, url);
    },
  };
  registerRuntimeAdapter(adapter, host);
  // Initialize the shared instance identity before services start loading config concurrently.
  await loadConfig();
  const menus = createBrowserMenus(() => sync.request());
  const sync = createMenuSync({
    log: createDebugLog(), focus: createWindowFocus(), browserMenus: menus,
    desktop: { isOpen: () => false, send: unsupported, requestWindowPairing: unsupported },
    browserInjection: { reconcile: async () => {} },
  });
  const mounted = new Map<string, ReturnType<typeof mountBrowserMenu>>();
  let surface: HTMLElement | undefined;
  let container: HTMLElement | undefined;
  type SettingsPanel = { element: HTMLElement; dialog: HTMLDialogElement; app?: Awaited<ReturnType<typeof import("./settings").mount>> };
  let settings: SettingsPanel | undefined;
  let rendering = Promise.resolve();
  const report = (error: unknown): void => { console.error("BrowseRail userscript:", error); };

  function clearMenus(): void {
    for (const menu of mounted.values()) menu.destroy();
    mounted.clear(); surface?.remove(); surface = undefined; container = undefined;
  }
  async function renderMenus(): Promise<void> {
    if (lifetime.signal.aborted) return;
    const next = await menus.forTab(1);
    if (!next.length) { clearMenus(); return; }
    if (!container) {
      surface = document.createElement("browserail-menus");
      for (const [key, value] of Object.entries({ all: "initial", position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "2147483647", "pointer-events": "none" }))
        surface.style.setProperty(key, value, "important");
      const shadow = surface.attachShadow({ mode: "closed" });
      const sheet = new CSSStyleSheet(); sheet.replaceSync(menuStyles + "\n" + hostStyles);
      shadow.adoptedStyleSheets.push(sheet);
      container = document.createElement("div"); container.className = "browser-menus";
      shadow.append(container); document.body.append(surface);
    }
    const zoom = document.body.currentCSSZoom;
    surface!.style.setProperty("zoom", String(1 / zoom), "important");
    const keep = new Set(next.map(menu => menu.view.uid));
    for (const [uid, mountedMenu] of mounted) if (!keep.has(uid)) { mountedMenu.destroy(); mounted.delete(uid); }
    for (const menu of next) {
      const existing = mounted.get(menu.view.uid);
      if (existing) await existing.update(menu);
      else mounted.set(menu.view.uid, mountBrowserMenu(container, menu, async command => {
        const reply = await adapter.messaging.send({ type: BAR_COMMAND_MESSAGE, command } satisfies BarCommand) as
          { error?: string; result?: import("@browserail/protocol/content").MenuCommandResult } | undefined;
        if (!reply) throw new Error("Menu action received no reply");
        if (reply.error) throw new Error(reply.error);
        await requestSync();
        return reply.result;
      }));
    }
  }
  async function requestSync(): Promise<void> {
    await sync.request();
    rendering = rendering.then(renderMenus).catch(report);
    await rendering;
  }
  const editingState = async () => ({ enabled: await loadWidgetEnabled(), editing: await loadBrowserEditing() });
  adapter.messaging.onMessage.addListener(message => {
    if (isExternalRun(message) && message.type === EXTERNAL_RUN_MESSAGE) return loadExternalAuthorization().then(authorization => {
      if (!authorization.userscriptEnabled || !authorization.token) return false;
      document.dispatchEvent(new CustomEvent(message.eventName, { detail: message.detail }));
      return true;
    });
    if (isEditingRequest(message)) return (async () => {
      if (message.type === EDITING_SET) await saveBrowserEditing(message.editing);
      return editingState();
    })();
    if (isConfigSaved(message) && message.type === CONFIG_SAVED) return requestSync().then(() => ({ ok: true }));
    if (isMenuLayoutReset(message) && message.type === MENU_LAYOUT_RESET) return removeBrowserPlacement(message.menuUid).then(requestSync).then(() => ({ ok: true }));
    if (isDesktopRequest(message)) {
      if (message.type === DESKTOP_STATE_REQUEST) return Promise.resolve({ state: "disabled" });
      if (message.type === WIDGET_ENABLED_SET) return saveWidgetEnabled(message.enabled).then(requestSync).then(() => ({ ok: true }));
    }
    if (isBarRefresh(message)) return requestSync().then(() => ({ updated: true }));
  });
  const externalUpdates = createExternalUpdates(() => { void requestSync().catch(report); });
  let externalEvent = "";
  let externalToken = "";
  let authorizationRevision = 0;
  function receiveExternal(event: Event): void {
    const detail: unknown = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string" || detail.length > MAX_EXTERNAL_MESSAGE_BYTES) return;
    let message: unknown;
    try { message = JSON.parse(detail); } catch { return; }
    void externalUpdates({ kind: "userscript", token: externalToken, url: location.href }, message).catch(report);
  }
  async function refreshExternalAuthorization(): Promise<void> {
    const revision = ++authorizationRevision;
    if (externalEvent) document.removeEventListener(externalEvent, receiveExternal);
    externalEvent = ""; externalToken = "";
    const authorization = await loadExternalAuthorization();
    if (lifetime.signal.aborted || revision !== authorizationRevision || !authorization.userscriptEnabled || !authorization.token) return;
    externalToken = authorization.token;
    externalEvent = userscriptUpdateEvent(externalToken);
    document.addEventListener(externalEvent, receiveExternal);
  }
  initDynamicBookmarks(() => { void requestSync().catch(report); });
  adapter.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[BROWSER_EDITING_STORAGE_KEY] || changes[WIDGET_ENABLED_STORAGE_KEY]) void renderUserMenu().catch(report);
    if (changes[EXTERNAL_AUTHORIZATION_STORAGE_KEY]) void refreshExternalAuthorization().catch(report);
    void requestSync().catch(report);
    void editingState().then(state => adapter.messaging.send({ type: EDITING_STATE_CHANGED, ...state })).catch(report);
  });

  function closeSettings(): void {
    const panel = settings;
    settings = undefined;
    panel?.app?.destroy();
    panel?.element.remove();
  }
  async function openSettings(): Promise<void> {
    if (lifetime.signal.aborted) return;
    if (settings?.element.isConnected) { settings.dialog.focus(); return; }
    closeSettings();
    const element = document.createElement("browserail-settings");
    const shadow = element.attachShadow({ mode: "closed" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(closeButtonStyles + `
      :host { all: initial; }
      dialog { padding: 0; border: 0; border-radius: 12px; width: min(800px, 96vw); height: 94dvh;
        max-width: none; max-height: none; background: #f4f6fb; color: #172033; overflow: hidden; }
      dialog[open] { display: flex; flex-direction: column; }
      dialog::backdrop { background: #0006; }
      .picker-close-btn { align-self: flex-end; margin: 6px 12px; flex-shrink: 0; }
      iframe { width: 100%; flex: 1; min-height: 0; border: 0; }
      p { margin: 24px; font: 14px system-ui, sans-serif; overflow-wrap: anywhere; }
    `);
    shadow.adoptedStyleSheets.push(sheet);
    const dialog = document.createElement("dialog");
    const panel: SettingsPanel = { element, dialog };
    const dismiss = (): void => { if (settings === panel) closeSettings(); };
    dialog.setAttribute("aria-label", t("action.openOptions"));
    const close = document.createElement("button");
    close.type = "button"; close.className = "picker-close-btn"; close.textContent = "✕";
    close.setAttribute("aria-label", t("common.close"));
    close.addEventListener("click", dismiss);
    dialog.addEventListener("close", dismiss);
    const iframe = document.createElement("iframe");
    iframe.title = t("action.openOptions");
    const loaded = new Promise<void>((resolve, reject) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.addEventListener("error", reject, { once: true });
    });
    dialog.append(close, iframe); shadow.append(dialog);
    settings = panel;
    document.body.append(element);
    dialog.showModal();
    try {
      await loaded;
      if (settings !== panel) return;
      const entry = __BROWSERAIL_SETTINGS__(iframe.contentWindow!);
      panel.app = await entry.mount(adapter, host);
      if (settings !== panel) panel.app.destroy();
    } catch (error) {
      if (settings === panel) {
        iframe.remove();
        const message = document.createElement("p");
        message.textContent = String(error);
        dialog.append(message);
      }
      throw error;
    }
  }
  const userMenuActions: Partial<Record<UserMenuId, () => Promise<void>>> = {
    [ENABLE_MENU_ID]: async () => { await saveWidgetEnabled(!await loadWidgetEnabled()); },
    [EDIT_MENU_ID]: async () => {
      if (await loadWidgetEnabled()) await saveBrowserEditing(!await loadBrowserEditing());
    },
    [OPTIONS_MENU_ID]: openSettings,
    [ADD_STATIC_MENU_ID]: async () => {
      const name = window.prompt(t("customBookmarks.name"), document.title);
      if (name === null) return;
      const config = await loadConfig();
      config.staticBookmarks.push({ uid: crypto.randomUUID(), name: name.trim(), url: location.href });
      await saveConfig(config);
    },
  };
  let userMenuRevision = 0;
  async function renderUserMenu(): Promise<void> {
    const revision = ++userMenuRevision;
    const [enabled, editing] = await Promise.all([loadWidgetEnabled(), loadBrowserEditing()]);
    if (lifetime.signal.aborted || revision !== userMenuRevision) return;
    for (const item of USER_MENU_ITEMS) {
      const action = userMenuActions[item.id];
      if (!action) continue;
      const checked = item.id === ENABLE_MENU_ID ? enabled : enabled && editing;
      const label = t(item.title) + (item.type === "checkbox" ? `: ${checked ? "ON" : "OFF"}` : "");
      api.registerMenuCommand(label, () => { void action().catch(report); }, { id: item.id });
    }
  }
  const stopUserMenuLanguage = onLanguageChange(() => { void renderUserMenu().catch(report); });
  await renderUserMenu();

  let lastUrl = "";
  async function navigationChanged(): Promise<void> {
    if (lifetime.signal.aborted) return;
    if (location.href === lastUrl) return;
    if (document.visibilityState === "hidden") return;
    lastUrl = location.href;
    const tab = await adapter.navigation.get(1);
    for (const listener of tabUpdates) listener(1, { url: lastUrl }, tab);
    await requestSync();
  }
  for (const event of ["popstate", "hashchange", "pageshow", "focus"]) window.addEventListener(event, () => { void navigationChanged().catch(report); }, { signal: lifetime.signal });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") void navigationChanged().then(requestSync).catch(report);
  }, { signal: lifetime.signal });
  window.addEventListener("resize", () => { void requestSync().catch(report); }, { signal: lifetime.signal });
  const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void navigationChanged().catch(report); }, 500);
  async function destroy(): Promise<void> {
    if (lifetime.signal.aborted) return;
    lifetime.abort(); window.clearInterval(timer); clearMenus(); closeSettings(); stopUserMenuLanguage(); icons.destroy();
    if (externalEvent) document.removeEventListener(externalEvent, receiveExternal);
    rewrite?.destroy(); if (workerUrl) URL.revokeObjectURL(workerUrl);
    for (const listener of tabRemovals) listener(1);
    tabUpdates.clear(); tabRemovals.clear();
    await adapter.destroy();
  }
  window.addEventListener("pagehide", event => { if (!event.persisted) void destroy().catch(report); }, { signal: lifetime.signal });
  await Promise.all([navigationChanged(), refreshExternalAuthorization()]);
  return { destroy, openSettings };
}

export const startup: Promise<Awaited<ReturnType<typeof startUserscript>>> = createUserscriptRuntimeAdapter(GM, {
  page: window, openSettings: () => startup.then(app => app.openSettings()), resources: __BROWSERAIL_RESOURCES__,
})
  .then(adapter => startUserscript(adapter, GM, __BROWSERAIL_REWRITE_WORKER__));
void startup.catch(error => console.error("BrowseRail userscript:", error));
