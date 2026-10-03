import { DEFAULT_DOCK_COLOR, invertNavigationActionUid, type FolderEntry, type LayoutEntry } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import { applyBarTheme, menuButton } from "../appearance";
import { applyBarLayout } from "../layout";
import { createLifetime, showMenuError } from "../lifetime";
import { attachTemporaryBookmarkButton } from "../temporary-bookmark";
import type { BarHost, BarState, Controller, PopupSession } from "../types";

export function mountBar(root: HTMLElement, initial: BarState, host: BarHost): Controller<BarState> {
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
  const waiting: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  const run = (action: Promise<void>): void => {
    void action.catch(error => { if (lifetime.alive) showMenuError(root, error); });
  };
  const clearExpanded = (): void => {
    for (const button of root.querySelectorAll(".menu-button[data-expanded]")) button.removeAttribute("data-expanded");
  };
  const cancelHover = (): void => {
    renderLifetime.cancelTimeout(hoverTimer);
    hoverTimer = undefined;
    hoverPending = false;
  };
  const requestClose = (): void => { session?.requestClose(); };
  const cancelClose = (): void => { session?.cancelClose(); };
  async function flush(): Promise<void> {
    if (!lifetime.alive || !pendingRender) return;
    pendingRender = false;
    render();
    const awaiting = waiting.splice(0);
    try { await lifetime.settle(); for (const item of awaiting) item.resolve(); }
    catch (error) { for (const item of awaiting) item.reject(error); throw error; }
  }
  async function closePopup(): Promise<void> {
    opening++;
    const closing = session;
    session = undefined;
    activeFolder = undefined;
    clearExpanded();
    await closing?.close();
    await flush();
  }
  const dispatch = (uid: string): void => {
    if (uid.startsWith("noop")) return;
    run(closePopup());
    run(host.invokeAction(uid));
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
  async function openPopup(entry: FolderEntry, button: HTMLElement): Promise<void> {
    if (!state.editingLocked || !lifetime.alive || doc.hidden || waitForPointerMovement) return;
    cancelHover();
    cancelClose();
    clearExpanded();
    button.toggleAttribute("data-expanded", true);
    activeFolder = entry.uid;
    const previous = session;
    session = undefined;
    const token = ++opening;
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
      });
      if (!lifetime.alive || token !== opening) { await opened.close(); return; }
      session = opened;
      opened.setBarPointerInside(pointerInside);
      void opened.closed.then(() => {
        if (!lifetime.alive || session !== opened) return;
        session = undefined;
        activeFolder = undefined;
        clearExpanded();
        run(flush());
      });
    } catch (error) {
      if (token === opening && lifetime.alive) {
        activeFolder = undefined;
        clearExpanded();
        await flush();
        throw error;
      }
    }
  }
  function renderEntry(entry: LayoutEntry): HTMLElement {
    const options = { signal: renderLifetime.signal };
    const button = menuButton(doc, entry, false);
    if (entry.kind === "menuFold") {
      button.classList.add("menu-toggle-button");
      button.title = state.collapsed ? t("menu.expand") : t("menu.collapse");
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || (!state.editingLocked && !state.collapsed)) return;
        event.preventDefault();
        run((async () => { await closePopup(); await host.requestToggleFold(); })());
      }, options);
    } else if (entry.kind === "browserAction" || entry.kind === "menusToggle") {
      button.addEventListener("pointerenter", requestClose, options);
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !state.editingLocked) return;
        event.preventDefault();
        dispatch(entry.uid);
      }, options);
    } else if (entry.kind === "bookmark") {
      button.addEventListener("pointerenter", requestClose, options);
      if (entry.uid.startsWith("temporary:")) {
        const dispose = attachTemporaryBookmarkButton(button, entry, {
          invokeAction: async uid => { dispatch(uid); },
          requestTemporarySave: input => host.requestTemporarySave(input),
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
    } else if (entry.expandOnHover !== false) {
      scheduleHover(button, () => { if (entry.children.length) run(openPopup(entry, button)); });
      button.addEventListener("focus", () => {
        if (doc.hidden || waitForPointerMovement) return;
        cancelClose(); if (entry.children.length) run(openPopup(entry, button));
      }, options);
    } else {
      button.addEventListener("pointerenter", () => { if (activeFolder && activeFolder !== entry.uid) requestClose(); }, options);
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !state.editingLocked) return;
        event.preventDefault();
        if (activeFolder === entry.uid) run(closePopup());
        else if (entry.children.length) run(openPopup(entry, button));
      }, options);
    }
    return button;
  }
  function render(): void {
    renderLifetime.destroy();
    renderLifetime = createLifetime(root);
    hoverTimer = undefined;
    hoverPending = false;
    pointerInside = false;
    const theme = applyBarTheme(root, state);
    root.classList.add("browserail-menu-ui", "menu-surface");
    const bar = doc.createElement("div");
    bar.className = "menu-bar";
    bar.ariaLabel = t("aria.menu");
    bar.dataset.orientation = state.menu.orientation;
    bar.style.setProperty("--config-bar-font-size", `${theme.buttonFontSize}px`);
    bar.style.setProperty("--config-bar-background", state.menu.dockColor || DEFAULT_DOCK_COLOR);
    const options = { signal: renderLifetime.signal };
    bar.addEventListener("pointerenter", () => { pointerInside = true; session?.setBarPointerInside(true); }, options);
    bar.addEventListener("pointerleave", () => { pointerInside = false; session?.setBarPointerInside(false); }, options);
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
    root.replaceChildren(bar);
  }
  root.addEventListener("pointerout", event => {
    if (!event.relatedTarget) { pointerInside = false; session?.setBarPointerInside(false); }
  }, { signal: lifetime.signal, passive: true });
  doc.addEventListener("visibilitychange", () => {
    cancelHover();
    pointerInside = false;
    waitForPointerMovement = true;
    if (doc.hidden) run(closePopup());
  }, { signal: lifetime.signal });
  // Restoring a tab can replay pointer entry and focus at the old cursor position.
  doc.addEventListener("pointermove", event => {
    if (!doc.hidden && Math.abs(event.movementX) + Math.abs(event.movementY) > 0) waitForPointerMovement = false;
  }, { capture: true, passive: true, signal: lifetime.signal });
  root.addEventListener("pointerdown", () => {
    if (!doc.hidden) waitForPointerMovement = false;
  }, { capture: true, signal: lifetime.signal });
  doc.addEventListener("keydown", event => {
    if (!doc.hidden && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "Tab" || event.key.startsWith("Arrow"))) waitForPointerMovement = false;
  }, { capture: true, signal: lifetime.signal });
  render();
  return {
    ready: lifetime.settle().then(() => {}),
    async update(next): Promise<void> {
      if (!lifetime.alive) return;
      state = next;
      applyBarTheme(root, state);
      if (activeFolder) {
        pendingRender = true;
        return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      }
      render();
      await lifetime.settle();
    },
    destroy(): void {
      opening++;
      lifetime.destroy();
      renderLifetime.destroy();
      for (const item of waiting.splice(0)) item.resolve();
      root.replaceChildren();
      root.classList.remove("browserail-menu-ui", "menu-surface");
    },
  };
}
