import { DEFAULT_AUTO_HIDE_PADDING } from "@browserail/protocol";
import { barSurfaceDimensions } from "../layout";
import { createLifetime } from "../lifetime";
import type { BarHost, BarState, Rect } from "../types";

const PEEK_SIZE = 6;
const REVEAL_DELAY = 150;
const HIDE_DELAY = 400;

export function createBarAutoHide(root: HTMLElement, host: BarHost, canReveal: () => boolean, beforeHide: () => void, report: (work: Promise<void>) => void) {
  const lifetime = createLifetime(root);
  let state: BarState;
  let viewport: HTMLElement;
  let content: HTMLElement;
  let enabled = false;
  let hidden = false;
  let pointerInside = false;
  let held = false;
  let mode = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRegion: string | undefined;
  let committed = Promise.resolve();

  function cancel(): void { lifetime.cancelTimeout(timer); timer = undefined; }
  function paint(): void {
    if (!viewport) return;
    const { width, height } = barSurfaceDimensions(state.menu, state.itemSize, state.collapsed);
    const horizontalMotion = state.menu.orientation === "column";
    const distance = Math.max(0, (horizontalMotion ? width : height) - PEEK_SIZE);
    const hitInset = Math.max(0, distance - (state.menu.autoHidePadding ?? DEFAULT_AUTO_HIDE_PADDING));
    const shift = (state.menu.autoHide === "start" ? -1 : 1) * distance;
    let region: Rect | null = null;
    if (hidden) {
      region = { left: 0, top: 0, right: width, bottom: height };
      if (horizontalMotion) {
        if (shift < 0) region.right = width - hitInset;
        else region.left = hitInset;
      } else {
        if (shift < 0) region.bottom = height - hitInset;
        else region.top = hitInset;
      }
    }
    viewport.style.pointerEvents = enabled ? "auto" : "none";
    viewport.style.clipPath = region ? `inset(${region.top}px ${width - region.right}px ${height - region.bottom}px ${region.left}px)` : "";
    content.style.transform = hidden ? `translate(${horizontalMotion ? shift : 0}px, ${horizontalMotion ? 0 : shift}px)` : "";
    // The host's larger hit region must not expose more of the button bodies.
    content.style.clipPath = !hidden ? "" : horizontalMotion
      ? `inset(0 ${shift > 0 ? distance : 0}px 0 ${shift < 0 ? distance : 0}px)`
      : `inset(${shift < 0 ? distance : 0}px 0 ${shift > 0 ? distance : 0}px 0)`;
    content.inert = hidden;
    viewport.toggleAttribute("data-auto-hidden", hidden);
    const signature = region ? `${root.ownerDocument.defaultView!.devicePixelRatio}:${JSON.stringify(region)}` : "null";
    if (signature !== lastRegion) {
      lastRegion = signature;
      committed = host.commitHitRegion?.(region) ?? Promise.resolve();
      report(committed);
    }
  }
  function setHidden(value: boolean): void {
    cancel();
    if (hidden === value) return;
    hidden = value;
    if (hidden) beforeHide();
    paint();
  }
  function schedule(): void {
    if (!enabled || !lifetime.alive || timer !== undefined) return;
    if (hidden) {
      if (!pointerInside || !canReveal()) return;
      timer = lifetime.timeout(() => {
        timer = undefined;
        if (pointerInside && canReveal()) setHidden(false);
      }, REVEAL_DELAY);
    } else if (!pointerInside && !held) {
      timer = lifetime.timeout(() => {
        timer = undefined;
        if (!pointerInside && !held) setHidden(true);
      }, HIDE_DELAY);
    }
  }
  root.ownerDocument.defaultView!.addEventListener("resize", paint, { signal: lifetime.signal });
  return {
    get hidden() { return hidden; },
    get ready() { return committed; },
    update(next: BarState, nextViewport?: HTMLElement, nextContent?: HTMLElement): void {
      state = next;
      if (nextViewport && nextContent) { viewport = nextViewport; content = nextContent; }
      enabled = next.editingLocked && !next.collapsed && (next.menu.autoHide ?? "off") !== "off";
      const nextMode = `${enabled}:${next.menu.orientation}:${next.menu.autoHide ?? "off"}`;
      if (nextMode !== mode) {
        mode = nextMode;
        cancel();
        hidden = enabled && !held && !pointerInside;
      }
      paint();
      schedule();
    },
    setPointerInside(inside: boolean): void {
      if (pointerInside !== inside) cancel();
      pointerInside = inside;
      schedule();
    },
    setHeld(value: boolean): void {
      if (held !== value) cancel();
      held = value;
      schedule();
    },
    pointerMoved(): void { schedule(); },
    suspend(): void {
      pointerInside = false;
      cancel();
      if (enabled) { hidden = true; paint(); }
    },
    destroy(): void {
      lifetime.destroy();
      if (lastRegion !== undefined && lastRegion !== "null") report(host.commitHitRegion?.(null) ?? Promise.resolve());
    },
  };
}
