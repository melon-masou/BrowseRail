import { DEFAULT_DOCK_COLOR, invertNavigationActionUid, type FolderEntry, type LayoutEntry } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import { applyActionError, applyBarTheme, applyFolderPin, menuButton } from "../appearance";
import { applyBarLayout } from "../layout";
import { createLifetime, showMenuError } from "../lifetime";
import { attachTemporaryBookmarkButton } from "../temporary-bookmark";
import type { BarHost, BarState, BarController, PopupSession, PopupPin, FolderPin } from "../types";
import { createBarAutoHide } from "./auto-hide";

export function mountBar(root: HTMLElement, initial: BarState, host: BarHost): BarController {
  const doc = root.ownerDocument;
  const lifetime = createLifetime(root, host.waitForFonts);
  let renderLifetime = createLifetime(root);
  let state = initial;
  let session: PopupSession | undefined;
  let activeFolder: string | undefined;
  let pointerInside = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverPending = false;
  let waitForPointerMovement = doc.hidden;
  let pendingRender = false;
  let opening = 0;
  let popupOpening = false;
  let popupInside = false;
  let popupPin: PopupPin = "none";
  const actionErrors = new Map<string, string>();
  const pendingPins: FolderPin[] = [];
  const waiting: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  const run = (action: Promise<void>): void => {
    void action.catch(error => { if (lifetime.alive) showMenuError(root, error); });
  };
  const autoHide = createBarAutoHide(root, host, () => !doc.hidden && !waitForPointerMovement,
    () => { cancelHover(); run(closePopup()); }, run);
  const updatePopupHold = (): void => { autoHide.setHeld(popupOpening || popupInside || popupPin !== "none"); };
  const clearExpanded = (): void => {
    for (const button of root.querySelectorAll<HTMLElement>(".menu-button[data-folder]")) {
      button.removeAttribute("data-expanded");
      applyFolderPin(button, "none");
    }
  };
  const cancelHover = (): void => {
    renderLifetime.cancelTimeout(hoverTimer);
    hoverTimer = undefined;
    hoverPending = false;
  };
  const cancelClose = (): void => { session?.cancelClose(); };
  async function flush(): Promise<void> {
    if (!lifetime.alive || !pendingRender) return;
    pendingRender = false;
    render();
    const awaiting = waiting.splice(0);
    try { await lifetime.settle(); await autoHide.ready; for (const item of awaiting) item.resolve(); }
    catch (error) { for (const item of awaiting) item.reject(error); throw error; }
  }
  async function closePopup(): Promise<void> {
    opening++;
    const closing = session;
    session = undefined;
    activeFolder = undefined;
    popupOpening = false;
    popupInside = false;
    popupPin = "none";
    pendingPins.length = 0;
    updatePopupHold();
    clearExpanded();
    await closing?.close();
    await flush();
  }
  const actionKey = (uid: string): string => uid.split("?")[0]!;
  function containsAction(entry: LayoutEntry, key: string): boolean {
    return actionKey(entry.uid) === key || (entry.kind === "folder" && entry.children.some(child => containsAction(child, key)));
  }
  function entryError(entry: LayoutEntry): string | undefined {
    return [...actionErrors].find(([key]) => containsAction(entry, key))?.[1];
  }
  function setActionError(uid: string, error?: string): void {
    if (!lifetime.alive) return;
    const key = actionKey(uid);
    if (error === undefined) actionErrors.delete(key);
    else actionErrors.set(key, error);
    for (const button of root.querySelectorAll<HTMLElement>(".menu-button[data-action-uid]")) {
      const entry = state.menu.items.find(entry => entry.uid === button.dataset.actionUid);
      if (entry) applyActionError(button, entryError(entry));
    }
  }
  const dispatch = (uid: string): void => {
    if (uid.startsWith("noop") || autoHide.hidden) return;
    if (popupPin === "locked") run(session?.dismiss() ?? Promise.resolve());
    else run(closePopup());
    void host.invokeAction(uid).catch(error => setActionError(uid, String(error)));
  };
  function scheduleHover(button: HTMLElement, open: () => void): void {
    const schedule = (): void => {
      cancelHover();
      hoverPending = true;
      if (doc.hidden || waitForPointerMovement) return;
      hoverTimer = renderLifetime.timeout(() => {
        hoverPending = false;
        hoverTimer = undefined;
        if (!doc.hidden && !waitForPointerMovement && button.isConnected) open();
      }, 60);
    };
    const options = { signal: renderLifetime.signal };
    button.addEventListener("pointerenter", () => { cancelClose(); schedule(); }, options);
    button.addEventListener("pointermove", () => { if (hoverPending) schedule(); }, options);
    button.addEventListener("pointerleave", cancelHover, options);
    button.addEventListener("pointercancel", cancelHover, options);
    button.addEventListener("pointerdown", cancelHover, { ...options, capture: true });
  }
  async function openPopup(entry: FolderEntry, button: HTMLElement, pin?: FolderPin, clicked = false): Promise<void> {
    if (!state.editingLocked || !lifetime.alive || doc.hidden || waitForPointerMovement || autoHide.hidden) return;
    if (activeFolder === entry.uid && (session || popupOpening)) {
      if (pin) {
        if (session) await session.togglePin(pin);
        else pendingPins.push(pin);
      } else if (entry.expandOnHover === false) {
        if (popupPin === "locked") {
          if (session) await session.togglePin("temporary");
          else pendingPins.push("temporary");
        } else await closePopup();
      }
      return;
    }
    if (popupPin === "locked" || (popupPin !== "none" && !clicked)) return;
    cancelHover();
    cancelClose();
    clearExpanded();
    button.toggleAttribute("data-expanded", true);
    applyFolderPin(button, pin ?? "none");
    activeFolder = entry.uid;
    const previous = session;
    session = undefined;
    const token = ++opening;
    popupOpening = true;
    popupInside = false;
    popupPin = pin ?? "none";
    pendingPins.length = 0;
    updatePopupHold();
    const theme = applyBarTheme(root, state);
    try {
      await previous?.close();
      if (!lifetime.alive || token !== opening) return;
      const opened = await host.openPopup({
        folder: entry,
        anchor: button.getBoundingClientRect(),
        theme: {
          ...(state.menu.color ? { color: state.menu.color } : {}),
          fontFamily: state.fontFamily,
          fontSize: theme.popupFontSize,
          itemHeight: theme.itemHeight,
        },
        direction: entry.expandDirection ?? state.menu.expandDirection ?? (state.menu.orientation === "column" ? "right" : "down"),
        expandAlignment: state.menu.expandAlignment ?? "edge",
        editingLocked: state.editingLocked,
        pin: popupPin,
      }, inside => {
        if (!lifetime.alive || token !== opening) return;
        popupInside = inside;
        updatePopupHold();
      }, (nextPin, rootPin) => {
        if (!lifetime.alive || token !== opening) return;
        popupPin = nextPin;
        applyFolderPin(button, rootPin);
        cancelHover();
        updatePopupHold();
      });
      if (!lifetime.alive || token !== opening || autoHide.hidden) { await opened.close(); return; }
      session = opened;
      popupOpening = false;
      updatePopupHold();
      opened.setBarPointerInside(pointerInside);
      void opened.closed.then(() => {
        if (!lifetime.alive || session !== opened) return;
        opening++;
        session = undefined;
        activeFolder = undefined;
        popupInside = false;
        popupPin = "none";
        pendingPins.length = 0;
        updatePopupHold();
        clearExpanded();
        run(flush());
      });
      for (const pending of pendingPins.splice(0)) await opened.togglePin(pending);
    } catch (error) {
      if (token === opening && lifetime.alive) {
        const failed = session;
        session = undefined;
        activeFolder = undefined;
        popupOpening = false;
        popupInside = false;
        popupPin = "none";
        pendingPins.length = 0;
        updatePopupHold();
        clearExpanded();
        await failed?.close();
        await flush();
        throw error;
      }
    }
  }
  function renderEntry(entry: LayoutEntry): HTMLElement {
    const options = { signal: renderLifetime.signal };
    const button = menuButton(doc, entry, false);
    button.dataset.actionUid = entry.uid;
    applyActionError(button, entryError(entry));
    if (entry.kind !== "folder" || entry.expandOnHover === false || !entry.children.length) {
      button.addEventListener("pointerenter", () => {
        if (popupPin === "none" && activeFolder && activeFolder !== entry.uid) run(closePopup());
      }, options);
    }
    if (entry.kind === "menuFold") {
      button.classList.add("menu-toggle-button");
      button.title = state.collapsed ? t("menu.expand") : t("menu.collapse");
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || (!state.editingLocked && !state.collapsed)) return;
        event.preventDefault();
        run((async () => { await closePopup(); await host.requestToggleFold(); })());
      }, options);
    } else if (entry.kind === "browserAction" || entry.kind === "menusToggle" || entry.kind === "shortcutsToggle") {
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !state.editingLocked) return;
        event.preventDefault();
        dispatch(entry.uid);
      }, options);
    } else if (entry.kind === "bookmark") {
      if (entry.uid.startsWith("temporary:")) {
        const dispose = attachTemporaryBookmarkButton(button, entry, {
          invokeAction: async uid => { dispatch(uid); },
          requestTemporarySave: input => autoHide.hidden ? Promise.resolve() : host.requestTemporarySave(input),
        }, {
          onShortPress: () => { if (state.editingLocked) dispatch(entry.uid); else run(host.requestCustomize()); },
          canAlternate: () => state.editingLocked,
        });
        renderLifetime.onDestroy(dispose);
      } else {
        button.addEventListener("pointerdown", event => {
          if (!state.editingLocked) return;
          if (event.button === 0) { event.preventDefault(); dispatch(entry.uid); }
          else if (event.button === 2) {
            event.preventDefault(); event.stopPropagation(); dispatch(invertNavigationActionUid(entry.uid));
          }
        }, options);
      }
    } else {
      if (entry.expandOnHover !== false) {
        scheduleHover(button, () => { if (entry.children.length) run(openPopup(entry, button)); });
        button.addEventListener("focus", () => {
          if (doc.hidden || waitForPointerMovement) return;
          cancelClose(); if (entry.children.length) run(openPopup(entry, button));
        }, options);
      }
      button.addEventListener("pointerdown", event => {
        if (!state.editingLocked || (event.button !== 0 && event.button !== 2)) return;
        event.preventDefault();
        if (entry.children.length) {
          const pin = event.button === 2 ? "locked" : entry.expandOnHover === false ? undefined : "temporary";
          run(openPopup(entry, button, pin, true));
        }
      }, options);
    }
    return button;
  }
  function render(): void {
    for (const key of actionErrors.keys()) {
      if (!state.menu.items.some(entry => containsAction(entry, key))) actionErrors.delete(key);
    }
    renderLifetime.destroy();
    renderLifetime = createLifetime(root);
    hoverTimer = undefined;
    hoverPending = false;
    pointerInside = false;
    autoHide.setPointerInside(false);
    const theme = applyBarTheme(root, state);
    root.classList.add("browserail-menu-ui", "menu-surface");
    const bar = doc.createElement("div");
    bar.className = "menu-bar";
    bar.ariaLabel = t("aria.menu");
    bar.dataset.orientation = state.menu.orientation;
    bar.style.setProperty("--config-bar-font-size", `${theme.buttonFontSize}px`);
    bar.style.setProperty("--config-bar-background", state.menu.dockColor || DEFAULT_DOCK_COLOR);
    const options = { signal: renderLifetime.signal };
    bar.addEventListener("pointerdown", event => {
      if (state.editingLocked || state.collapsed) return;
      event.preventDefault(); event.stopPropagation(); run(host.requestCustomize());
    }, options);
    bar.addEventListener("contextmenu", event => event.preventDefault(), options);
    const entries = state.collapsed ? state.menu.items.filter(entry => entry.kind === "menuFold").slice(0, 1) : state.menu.items;
    if (entries.length) bar.append(...entries.map(renderEntry));
    else {
      const empty = doc.createElement("div"); empty.className = "empty-menu"; empty.textContent = t("menu.empty"); bar.append(empty);
    }
    applyBarLayout(bar, { ...state.menu, items: entries }, state.itemSize);
    const viewport = doc.createElement("div"); viewport.className = "bar-viewport";
    const content = doc.createElement("div"); content.className = "bar-content";
    content.append(bar); viewport.append(content); root.replaceChildren(viewport);
    viewport.addEventListener("pointerenter", () => {
      pointerInside = true; session?.setBarPointerInside(true); autoHide.setPointerInside(true);
    }, options);
    viewport.addEventListener("pointerleave", () => {
      pointerInside = false; session?.setBarPointerInside(false); autoHide.setPointerInside(false);
    }, options);
    viewport.addEventListener("pointermove", () => autoHide.pointerMoved(), options);
    autoHide.update(state, viewport, content);
  }
  root.addEventListener("pointerout", event => {
    if (!event.relatedTarget) { pointerInside = false; session?.setBarPointerInside(false); autoHide.setPointerInside(false); }
  }, { signal: lifetime.signal, passive: true });
  doc.addEventListener("visibilitychange", () => {
    cancelHover();
    pointerInside = false;
    waitForPointerMovement = true;
    if (doc.hidden) { autoHide.suspend(); run(closePopup()); }
  }, { signal: lifetime.signal });
  // Restoring a tab can replay pointer entry and focus at the old cursor position.
  doc.addEventListener("pointermove", event => {
    if (!doc.hidden && Math.abs(event.movementX) + Math.abs(event.movementY) > 0) waitForPointerMovement = false;
  }, { capture: true, passive: true, signal: lifetime.signal });
  root.addEventListener("pointerdown", event => {
    if (!doc.hidden) waitForPointerMovement = false;
    if (autoHide.hidden) { event.preventDefault(); event.stopImmediatePropagation(); autoHide.pointerMoved(); }
  }, { capture: true, signal: lifetime.signal });
  doc.addEventListener("keydown", event => {
    if (!doc.hidden && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "Tab" || event.key.startsWith("Arrow"))) waitForPointerMovement = false;
  }, { capture: true, signal: lifetime.signal });
  render();
  return {
    setActionError,
    ready: lifetime.settle().then(() => autoHide.ready),
    async update(next): Promise<void> {
      if (!lifetime.alive) return;
      const resetInteraction = state.editingLocked !== next.editingLocked || state.collapsed !== next.collapsed
        || state.menu.autoHide !== next.menu.autoHide || state.menu.orientation !== next.menu.orientation;
      state = next;
      autoHide.update(state);
      if (resetInteraction) await closePopup();
      if (!lifetime.alive) return;
      applyBarTheme(root, state);
      if (activeFolder) {
        pendingRender = true;
        return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      }
      render();
      await lifetime.settle();
      await autoHide.ready;
    },
    destroy(): void {
      opening++;
      autoHide.destroy();
      lifetime.destroy();
      renderLifetime.destroy();
      for (const item of waiting.splice(0)) item.resolve();
      root.replaceChildren();
      root.classList.remove("browserail-menu-ui", "menu-surface");
    },
  };
}
