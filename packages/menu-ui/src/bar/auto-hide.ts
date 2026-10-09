import { applyBarHiddenAppearance, barHiddenArea } from "./hidden-area";
import { createLifetime } from "../lifetime";
import type { BarHost, BarState, Rect } from "../types";

const REVEAL_DELAY = 150;
const HIDE_DELAY = 200;

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
    const { surface: { width, height }, visible, hit, offset } = barHiddenArea(state.menu, state.itemSize);
    const region: Rect | null = hidden ? hit : null;
    viewport.style.clipPath = region ? `inset(${region.top}px ${width - region.right}px ${height - region.bottom}px ${region.left}px)` : "";
    content.style.transform = hidden && (offset.x || offset.y) ? `translate(${offset.x}px, ${offset.y}px)` : "";
    // The host's larger hit region must not expose more of the button bodies.
    content.style.clipPath = hidden
      ? `inset(${visible.top - offset.y}px ${width - visible.right + offset.x}px ${height - visible.bottom + offset.y}px ${visible.left - offset.x}px round var(--bar-radius, var(--dock-radius, 7px)))`
      : "";
    const bar = content.firstElementChild as HTMLElement;
    applyBarHiddenAppearance(bar, state.menu, state.itemSize, hidden);
    const backgroundEvents = state.editingLocked && !hidden
      ? root.ownerDocument.defaultView!.getComputedStyle(bar).getPropertyValue("--bar-background-pointer-events").trim()
      : "";
    // The hidden wake area must stay interactive even when the revealed background passes through.
    viewport.style.pointerEvents = hidden ? "auto"
      : backgroundEvents === "none" || backgroundEvents === "auto" ? backgroundEvents
      : enabled ? "auto" : "none";
    content.inert = hidden;
    viewport.toggleAttribute("data-auto-hidden", hidden);
    let regions: Rect[] | null = region ? [region] : null;
    if (!hidden && backgroundEvents === "none" && host.commitHitRegion) {
      const origin = root.getBoundingClientRect();
      regions = Array.from(bar.querySelectorAll<HTMLElement>(":scope > .menu-button, :scope > .empty-menu")).flatMap(button => {
        const bounds = button.getBoundingClientRect();
        const style = root.ownerDocument.defaultView!.getComputedStyle(button);
        if (!bounds.width || !bounds.height || style.visibility === "hidden") return [];
        return [{ left: bounds.left - origin.left, top: bounds.top - origin.top,
          right: bounds.right - origin.left, bottom: bounds.bottom - origin.top }];
      });
    }
    const signature = regions ? `${root.ownerDocument.defaultView!.devicePixelRatio}:${JSON.stringify(regions)}` : "null";
    if (signature !== lastRegion) {
      lastRegion = signature;
      committed = host.commitHitRegion?.(regions) ?? Promise.resolve();
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
      enabled = next.editingLocked && !next.collapsed && next.menu.autoHideEnabled !== false && (next.menu.autoHide ?? "off") !== "off";
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
