import { t } from "@browserail/i18n";
import { normalizeMenuSpacing, type MenuSpacing, type MenuView } from "@browserail/protocol";
import { applyBarLayout, barOffsets, gapRatioAfter } from "../layout";
import type { Size } from "../types";

/** Off, then every gap at once, then one gap at a time; the button cycles through them. */
export type SpacingMode = "off" | "all" | "single";

export function mountSpacingEditor(
  rail: HTMLElement,
  initialMenu: MenuView,
  initialSize: Size,
  button: HTMLButtonElement,
  onChange: (menu: MenuView, itemSize: Size) => void,
) {
  const doc = rail.ownerDocument;
  const menu = { ...initialMenu, ...normalizeMenuSpacing(initialMenu) };
  menu.extraGaps = Object.assign(Object.create(null) as Record<string, number>, menu.extraGaps);
  let itemSize = { ...initialSize };
  let mode: SpacingMode = "off";
  let stopGesture: (() => void) | undefined;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  let row = menu.orientation === "row";
  const label = doc.createElement("span"); label.className = "spacing-label"; rail.append(label);
  const handles = menu.items.slice(0, -1).map((entry, index) => {
    const handle = doc.createElement("div");
    handle.className = "gap-handle";
    handle.addEventListener("contextmenu", event => event.preventDefault(), options);
    handle.addEventListener("pointerdown", event => {
      if (mode === "off" || event.button !== 0 || !entry.uid) return;
      event.preventDefault();
      event.stopPropagation();
      stopGesture?.();
      const global = mode === "all";
      const start = global ? menu.gapRatio : menu.extraGaps[entry.uid] ?? 0;
      const position = row ? event.screenX : event.screenY;
      const dimension = row ? itemSize.width : itemSize.height;
      // A global drag changes the bar length once, spread across all gaps.
      const dragScale = global ? Math.max(1, handles.length) : 1;
      handle.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent): void => {
        if (next.pointerId !== event.pointerId) return;
        const ratio = Math.max(0, start + ((row ? next.screenX : next.screenY) - position) / (dimension * dragScale));
        if (global) menu.gapRatio = ratio;
        else if (ratio === 0) delete menu.extraGaps[entry.uid!];
        else menu.extraGaps[entry.uid!] = ratio;
        render();
        onChange(menu, itemSize);
      };
      const stop = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        handle.removeEventListener("lostpointercapture", stop);
        stopGesture = undefined;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };
      stopGesture = stop;
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      handle.addEventListener("lostpointercapture", stop);
    }, options);
    handle.addEventListener("dblclick", event => {
      event.preventDefault();
      event.stopPropagation();
      if (mode !== "single" || !entry.uid) return;
      delete menu.extraGaps[entry.uid];
      render();
      onChange(menu, itemSize);
    }, options);
    rail.append(handle);
    return { handle, index };
  });
  function render(): void {
    applyBarLayout(rail, menu, itemSize);
    const offsets = barOffsets(menu, itemSize);
    const dimension = row ? itemSize.width : itemSize.height;
    const hint = mode === "all" ? t("customize.spacingAllHint") : t("customize.spacingSingleHint");
    for (const { handle, index } of handles) {
      handle.hidden = mode === "off";
      handle.title = hint;
      const center = offsets[index]! + dimension * (1 + gapRatioAfter(menu, index) / 2);
      handle.style[row ? "left" : "top"] = `${center}px`;
    }
  }
  function setMode(next: SpacingMode): void {
    stopGesture?.();
    mode = next;
    rail.toggleAttribute("data-spacing", mode !== "off");
    const title = mode === "all" ? t("customize.spacingAll") : mode === "single" ? t("customize.spacingSingle") : t("customize.adjustSpacing");
    button.setAttribute("aria-pressed", String(mode !== "off"));
    button.title = title; button.ariaLabel = title;
    button.replaceChildren(createSpacingIcon(doc, mode === "single"));
    label.hidden = mode === "off";
    label.textContent = mode === "off" ? "" : title;
    render();
  }
  setMode("off");
  return {
    get enabled(): boolean { return mode !== "off"; },
    get mode(): SpacingMode { return mode; },
    get menu(): MenuView { return menu; },
    get itemSize(): Size { return { ...itemSize }; },
    get spacing(): MenuSpacing { return normalizeMenuSpacing(menu); },
    cycle(): void { setMode(mode === "off" ? "all" : mode === "all" ? "single" : "off"); },
    close(): void { setMode("off"); },
    setSettings(next: import("@browserail/protocol").BarSettings): void {
      stopGesture?.();
      delete menu.expandDirection;
      Object.assign(menu, next);
      row = menu.orientation === "row";
      rail.dataset.orientation = menu.orientation;
      for (const { handle } of handles) { handle.style.left = ""; handle.style.top = ""; }
      render();
      onChange(menu, itemSize);
    },
    setItemSize(next: Size): void { itemSize = { ...next }; render(); },
    stopGesture(): void { stopGesture?.(); },
    destroy(): void {
      stopGesture?.();
      lifetime.abort();
      for (const { handle } of handles) handle.remove();
      label.remove();
      rail.removeAttribute("data-spacing");
    },
  };
}

/** Two bars around arrows for all gaps; a single narrow gap for one gap. */
export function createSpacingIcon(doc: Document, single = false): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  const path = doc.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", single ? "M3 4v16M9 4v16M15 4v16M21 4v16M10 12h4" : "M3 4v16M21 4v16M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3");
  svg.append(path); return svg;
}
