import browser, { type Runtime } from "webextension-polyfill";
import menuStyles from "@browserail/menu-ui/styles.css?inline";
import hostStyles from "./styles.css?inline";
import type { BrowserMenuState, MenuReply } from "./messages";
import { mountBrowserMenu, type MenuCommand } from "./surface";

function createPageController() {
  let checking: Promise<void> | undefined;
  let rootWait: AbortController | undefined;
  let port: Runtime.Port | undefined;
  let nextId = 0;
  let host: HTMLElement | undefined;
  let container: HTMLElement | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;
  const pending = new Map<number, { resolve(): void; reject(error: unknown): void }>();
  const menus = new Map<string, ReturnType<typeof mountBrowserMenu>>();
  let rendering = Promise.resolve();
  let stateRevision = 0;

  function clearSurface(): void {
    for (const menu of menus.values()) menu.destroy();
    menus.clear(); host?.remove(); host = undefined; container = undefined;
  }

  function waitForDocumentRoot(): Promise<HTMLElement | null> {
    if (document.documentElement) return Promise.resolve(document.documentElement);
    const controller = new AbortController(); rootWait = controller;
    return new Promise(resolve => {
      const finish = (root: HTMLElement | null): void => {
        observer.disconnect(); controller.signal.removeEventListener("abort", cancel);
        if (rootWait === controller) rootWait = undefined;
        resolve(root);
      };
      const cancel = (): void => finish(null);
      const observer = new MutationObserver(() => {
        if (document.documentElement) finish(document.documentElement);
      });
      observer.observe(document, { childList: true });
      controller.signal.addEventListener("abort", cancel, { once: true });
    });
  }
  function send(command: MenuCommand): Promise<void> {
    if (!port) return Promise.reject(new Error("Extension is disconnected"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { port!.postMessage({ ...command, id }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }

  function disconnected(current: Runtime.Port, retry = true): void {
    if (port !== current) return;
    port = undefined; stateRevision++; clearSurface();
    for (const request of pending.values()) request.reject(new Error("Extension is disconnected"));
    pending.clear();
    if (retry && !suspended) reconnect = setTimeout(() => { void start(); }, 500);
  }

  function stop(): void {
    clearTimeout(reconnect); stateRevision++; checking = undefined; rootWait?.abort(); clearSurface();
    const current = port;
    if (current) { disconnected(current, false); current.disconnect(); }
  }

  function start(): Promise<void> {
    if (suspended || port) return Promise.resolve();
    if (checking) return checking;
    const revision = stateRevision;
    const check = browser.runtime.sendMessage({ type: "browserMenusSnapshot" }).then(value => {
      const state = value as BrowserMenuState;
      if (suspended || revision !== stateRevision || !state?.menus?.length) return;
      connect();
    }).catch(error => { console.error("BrowseRail connection:", error); }).finally(() => { if (checking === check) checking = undefined; });
    checking = check;
    return check;
  }

  function connect(): void {
    if (suspended || port) return;
    const current = browser.runtime.connect({ name: "browserail-menus" });
    port = current;
    current.onMessage.addListener((value: unknown) => {
      const message = value as BrowserMenuState | MenuReply;
      if (port !== current) return;
      if (message.type === "reply") {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error)); else request?.resolve();
        return;
      }
      if (message.type !== "state") return;
      const revision = ++stateRevision;
      if (!message.menus.length) { stop(); return; }
      rendering = rendering.then(async () => {
        if (port !== current || revision !== stateRevision) return;
        const keep = new Set(message.menus.map(menu => menu.view.uid));
        for (const [uid, menu] of menus) {
          if (!keep.has(uid)) { menu.destroy(); menus.delete(uid); }
        }
        if (!message.menus.length) { clearSurface(); return; }
        if (!container) {
          const documentRoot = await waitForDocumentRoot();
          if (!documentRoot || port !== current || revision !== stateRevision) return;
          host = document.createElement("browserail-menus");
          // The page's selectors must not size or position the host. All menu
          // styling stays inside the shadow tree.
          for (const [name, value] of Object.entries({ all: "initial", position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "2147483647", "pointer-events": "none" })) host.style.setProperty(name, value, "important");
          const shadow = host.attachShadow({ mode: "closed" });
          const sheet = new CSSStyleSheet(); sheet.replaceSync(menuStyles + "\n" + hostStyles); shadow.adoptedStyleSheets = [sheet];
          container = document.createElement("div"); container.className = "browser-menus"; shadow.append(container);
          documentRoot.append(host);
        }
        for (const menu of message.menus) {
          if (port !== current || revision !== stateRevision) return;
          const mounted = menus.get(menu.view.uid);
          if (mounted) await mounted.update(menu);
          else menus.set(menu.view.uid, mountBrowserMenu(container, menu, send));
        }
      }).catch(error => { console.error("BrowseRail menu:", error); });
    });
    current.onDisconnect.addListener(() => disconnected(current));
  }

  window.addEventListener("pagehide", () => { suspended = true; stop(); });
  window.addEventListener("pageshow", () => { suspended = false; void start(); });
  return { start };
}

// Dynamic registration and existing-tab activation may execute the same file.
// Keep one controller in this extension's isolated world for each document.
const scope = globalThis as typeof globalThis & { __browserailMenus?: ReturnType<typeof createPageController> };
scope.__browserailMenus ??= createPageController();
void scope.__browserailMenus.start();
