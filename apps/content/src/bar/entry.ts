import browser, { type Runtime } from "webextension-polyfill";
import menuStyles from "@browserail/menu-ui/styles.css?inline";
import hostStyles from "./styles.css?inline";
import { BAR_COMMAND_MESSAGE, BAR_SNAPSHOT_MESSAGE, isBarRefresh, type BrowserMenuState, type MenuReply, type MenuCommandResult } from "@browserail/protocol/content";
import { mountBrowserMenu, type MenuCommand } from "./surface";

function createPageController() {
  let checking: Promise<void> | undefined;
  let rootWait: AbortController | undefined;
  // let surfaceObserver: MutationObserver | undefined;
  let host: HTMLElement | undefined;
  let container: HTMLElement | undefined;
  let initialized = false;
  let suspended = false;
  const menus = new Map<string, ReturnType<typeof mountBrowserMenu>>();
  let rendering = Promise.resolve();
  let stateRevision = 0;

  function clearSurface(): void {
    // surfaceObserver?.disconnect(); surfaceObserver = undefined;
    for (const menu of menus.values()) menu.destroy();
    menus.clear(); host?.remove(); host = undefined; container = undefined;
  }

  /*
  function maintainSurface(element: HTMLElement, initialBody: HTMLElement): void {
    let observedBody = initialBody;
    const observer = new MutationObserver(() => {
      if (suspended || host !== element || !document.body) return;
      if (observedBody !== document.body) watch(document.body);
      if (element.parentNode !== document.body) document.body.append(element);
    });
    function watch(body: HTMLElement): void {
      observedBody = body;
      observer.disconnect();
      // Document-level renderers can remove foreign body children during startup.
      // Observe only the mounting parents, leaving the site's inner UI unwatched.
      observer.observe(document.documentElement, { childList: true });
      observer.observe(body, { childList: true });
    }
    surfaceObserver = observer;
    watch(initialBody);
  }
  */

  function waitForBody(): Promise<HTMLElement | null> {
    if (document.body) return Promise.resolve(document.body);
    const controller = new AbortController(); rootWait = controller;
    return new Promise(resolve => {
      const finish = (root: HTMLElement | null): void => {
        observer.disconnect(); controller.signal.removeEventListener("abort", cancel);
        if (rootWait === controller) rootWait = undefined;
        resolve(root);
      };
      const cancel = (): void => finish(null);
      const observer = new MutationObserver(() => {
        if (document.body) finish(document.body);
      });
      observer.observe(document, { childList: true, subtree: true });
      controller.signal.addEventListener("abort", cancel, { once: true });
    });
  }

  async function send(command: MenuCommand): Promise<MenuCommandResult | undefined> {
    const revision = stateRevision;
    const reply = await browser.runtime.sendMessage({ type: BAR_COMMAND_MESSAGE, command }) as MenuReply | undefined;
    if (reply?.error) throw new Error(reply.error);
    if (!reply) throw new Error("Menu action received no reply");
    if (reply.state && !suspended && revision === stateRevision) await renderState(reply.state);
    return reply.result;
  }

  function stop(): void {
    stateRevision++; checking = undefined; initialized = false; rootWait?.abort(); clearSurface();
  }

  function start(force = false): Promise<void> {
    if (suspended || (initialized && !force)) return Promise.resolve();
    if (checking) return checking;
    initialized = true;
    const revision = stateRevision;
    const check = browser.runtime.sendMessage({ type: BAR_SNAPSHOT_MESSAGE }).then(async value => {
      if (suspended || revision !== stateRevision) return;
      const state = value as BrowserMenuState;
      if (state?.type !== "state" || !Array.isArray(state.menus)) throw new Error("Invalid menu snapshot");
      await renderState(state);
    }).catch(error => { console.error("BrowseRail menu:", error); }).finally(() => { if (checking === check) checking = undefined; });
    checking = check;
    return check;
  }

  function renderState(message: BrowserMenuState): Promise<void> {
    const revision = ++stateRevision;
    if (!message.menus.length) { rootWait?.abort(); clearSurface(); return Promise.resolve(); }
    rendering = rendering.then(async () => {
      if (suspended || revision !== stateRevision) return;
      const keep = new Set(message.menus.map(menu => menu.view.uid));
      for (const [uid, menu] of menus) {
        if (!keep.has(uid)) { menu.destroy(); menus.delete(uid); }
      }
      if (!container) {
        const body = await waitForBody();
        if (!body || suspended || revision !== stateRevision) return;
        host = document.createElement("browserail-menus");
        // The page's selectors must not size or position the host. All menu
        // styling stays inside the shadow tree.
        for (const [name, value] of Object.entries({ all: "initial", position: "fixed", inset: "0", width: "100vw", height: "100vh", "z-index": "2147483647", "pointer-events": "none" })) host.style.setProperty(name, value, "important");
        const shadow = host.attachShadow({ mode: "closed" });
        const sheet = new CSSStyleSheet(); sheet.replaceSync(menuStyles + "\n" + hostStyles);
        // push, not `= [sheet]`: in Firefox a content-script array can't be assigned
        // to the page's adoptedStyleSheets (Xray wrapper error, bug 1827104).
        shadow.adoptedStyleSheets.push(sheet);
        container = document.createElement("div"); container.className = "browser-menus"; shadow.append(container);
        body.append(host);
        // Some React-based sites (e.g. GitHub repository pages) remove injected
        // nodes during document initialization. Mount recovery is disabled for now.
        // maintainSurface(host, body);
      }
      for (const menu of message.menus) {
        if (suspended || revision !== stateRevision) return;
        const mounted = menus.get(menu.view.uid);
        if (mounted) await mounted.update(menu);
        else menus.set(menu.view.uid, mountBrowserMenu(container, menu, send));
      }
    }).catch(error => { console.error("BrowseRail menu:", error); });
    return rendering;
  }

  browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender) => {
    if (!isBarRefresh(message) || sender.id !== browser.runtime.id) return undefined;
    return start(true).then(() => ({ updated: true }));
  });
  window.addEventListener("pagehide", () => { suspended = true; stop(); });
  window.addEventListener("pageshow", () => { suspended = false; void start(); });
  return { start };
}

// Registration can execute the script more than once in a document. Keep its
// existing UI and fetch a snapshot only on load or an explicit user operation.
const scope = globalThis as typeof globalThis & { __browserailMenus?: ReturnType<typeof createPageController> };
scope.__browserailMenus ??= createPageController();
void scope.__browserailMenus.start();
