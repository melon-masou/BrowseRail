import {
  mountFolderPopup, createLifetime, createTextMeasure, planFolderPopup,
  type MenuActions, type PopupRequest, type PopupSession, type PopupPin,
} from "@browserail/menu-ui";
import type { BrowserMenuPlacement } from "@browserail/protocol/content";

export async function openBrowserPopup(container: HTMLElement, bar: HTMLElement, anchor: BrowserMenuPlacement["anchor"], request: PopupRequest, actions: MenuActions, signal: AbortSignal, pointerInside: (inside: boolean) => void, onPinChanged: (pin: PopupPin, rootPin: PopupPin) => void): Promise<PopupSession> {
  if (signal.aborted) throw new Error("Menu was removed");
  const doc = container.ownerDocument;
  const root = doc.createElement("div");
  root.className = "browser-popup browserail-menu-ui";
  root.style.visibility = "hidden";
  root.style.setProperty("--menu-font-family", request.theme.fontFamily);
  container.append(root);
  const waitForFonts = () => doc.fonts.load(`${request.theme.fontSize}px ${request.theme.fontFamily}`);
  const lifetime = createLifetime(root, waitForFonts);
  const measure = createTextMeasure(root, lifetime);
  let renderer: ReturnType<typeof mountFolderPopup> | undefined;
  let done!: () => void;
  const closed = new Promise<void>(resolve => { done = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let barInside = true;
  let popupInside = false;
  let pin = request.pin;
  const cancelClose = (): void => { clearTimeout(timer); };
  const close = async (): Promise<void> => {
    if (!lifetime.alive) return;
    cancelClose(); lifetime.destroy(); renderer?.destroy(); root.remove();
    signal.removeEventListener("abort", abort);
    pointerInside(false);
    done();
  };
  const abort = (): void => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  const schedule = (): void => {
    cancelClose();
    if (pin === "none" && !barInside && !popupInside) timer = setTimeout(() => { void close(); }, 80);
  };
  const session: PopupSession = {
    async togglePin(next) { if (lifetime.alive) renderer?.toggleRootPin(next); },
    async dismiss() { if (lifetime.alive) renderer?.dismiss(); },
    closed, close, cancelClose,
    requestClose: schedule,
    setBarPointerInside(inside) { barInside = inside; schedule(); },
  };
  doc.addEventListener("pointerdown", event => {
    if (pin === "none") return;
    const path = event.composedPath();
    const treeRoot = container.getRootNode();
    const inOverlay = treeRoot instanceof doc.defaultView!.ShadowRoot ? path.includes(treeRoot.host) : path.includes(container);
    const contains = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom;
    };
    if (inOverlay && (contains(bar) || Array.from(root.querySelectorAll<HTMLElement>(".menu-column")).some(contains))) return;
    void session.dismiss();
  }, { capture: true, signal: lifetime.signal });
  try {
    await lifetime.settle();
    if (!lifetime.alive) return session;
    const right = anchor.endsWith("Right"), bottom = anchor.startsWith("bottom");
    const { width, height, available } = popupArea(container, bottom);
    let { surface, state } = planFolderPopup(measure, request, available);
    // Without some uncovered space nowhere is left to tap to dismiss the popup; keep it on the side away from the bar.
    const freeX = Math.max(24, width * 0.1), freeY = Math.max(24, height * 0.1);
    if (surface.left - available.left < freeX && available.right - surface.right < freeX
      && surface.top - available.top < freeY && available.bottom - surface.bottom < freeY) {
      ({ surface, state } = planFolderPopup(measure, request, right ? { ...available, left: available.left + freeX } : { ...available, right: available.right - freeX }));
    }
    // Anchored to the same edges as the bar, so the two move together when the viewport changes.
    Object.assign(root.style, {
      left: right ? "auto" : `${surface.left}px`, right: right ? `${width - surface.right}px` : "auto",
      top: bottom ? "auto" : `${surface.top}px`, bottom: bottom ? `${height - surface.bottom}px` : "auto",
      width: `${surface.right - surface.left}px`, height: `${surface.bottom - surface.top}px`,
    });
    renderer = mountFolderPopup(root, state, {
      ...actions, close, waitForFonts,
      get pin() { return pin; },
      async setPin(next, rootPin) {
        if (!lifetime.alive) return;
        pin = next; onPinChanged(next, rootPin); schedule();
      },
      setPointerInside(inside) { popupInside = inside; pointerInside(inside); schedule(); },
      async commitLayout() {},
    });
    await renderer.ready;
    if (lifetime.alive) root.style.visibility = "visible";
    return session;
  } catch (error) { await close(); throw error; }
}

/**
 * Mobile toolbars cover the bottom of the viewport while shown, so popups are planned within the small viewport,
 * taken from the edge they move with.
 */
function popupArea(container: HTMLElement, bottom: boolean) {
  const probe = container.ownerDocument.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:100svh;width:0";
  container.append(probe);
  const width = container.clientWidth, height = container.clientHeight;
  const visible = Math.min(height, probe.getBoundingClientRect().height);
  probe.remove();
  return { width, height, available: { left: 0, right: width, top: bottom ? height - visible : 0, bottom: bottom ? height : visible } };
}
