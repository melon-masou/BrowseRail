import { t } from "@browserail/i18n";
import type { BarSettings, MenuView } from "@browserail/protocol";
import { barFrameInsets, barSurfaceDimensions } from "../layout";
import type { Rect, Size } from "../types";
import { applyBarHiddenAppearance, barHiddenArea, barHiddenRange } from "./hidden-area";

export function mountHideRangeEditor(rail: HTMLElement, initialMenu: MenuView, initialSize: Size, button: HTMLButtonElement, changed: (patch: Pick<BarSettings, "autoHideRange" | "autoHidePadding">) => void) {
  let menu = initialMenu;
  let itemSize = initialSize;
  let mode: "off" | "range" | "sense" = "off";
  let stopGesture: (() => void) | undefined;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const doc = rail.ownerDocument;
  const overlay = doc.createElement("div"); overlay.className = "hide-range-overlay";
  const before = doc.createElement("div"), after = doc.createElement("div");
  before.className = after.className = "hide-range-dim";
  const band = doc.createElement("div"); band.className = "hide-range-band";
  const sensor = doc.createElement("div"); sensor.className = "hide-range-sensor";
  const label = doc.createElement("span"); label.className = "hide-range-label";
  const preview = doc.createElement("div"); preview.className = "hide-range-preview";
  preview.inert = true; preview.setAttribute("aria-hidden", "true");
  function padding(): number {
    const { visible, hit } = barHiddenArea(menu, itemSize);
    return menu.orientation === "column"
      ? (hit.right - hit.left) - (visible.right - visible.left)
      : (hit.bottom - hit.top) - (visible.bottom - visible.top);
  }
  const handles = (["start", "end"] as const).map(boundary => {
    const handle = doc.createElement("div");
    handle.className = "hide-range-handle"; handle.dataset.boundary = boundary;
    handle.tabIndex = 0; handle.setAttribute("role", "slider");
    handle.addEventListener("pointerdown", event => {
      if (mode === "off" || handle.hidden || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); stopGesture?.();
      const horizontal = menu.orientation === "column";
      const surface = barSurfaceDimensions(menu, itemSize);
      const extent = horizontal ? surface.width : surface.height;
      const initial = mode === "sense" ? padding() : barHiddenRange(menu, itemSize)[boundary];
      const coordinate = horizontal ? event.screenX : event.screenY;
      handle.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent): void => {
        if (next.pointerId !== event.pointerId) return;
        const delta = (horizontal ? next.screenX : next.screenY) - coordinate;
        if (mode === "sense") setPadding(initial + delta * (menu.autoHide === "end" ? -1 : 1));
        else setBoundary(boundary, initial + delta / extent);
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
    handle.addEventListener("keydown", event => {
      if (mode === "off" || handle.hidden) return;
      const horizontal = menu.orientation === "column";
      const backwards = horizontal ? "ArrowLeft" : "ArrowUp";
      const forwards = horizontal ? "ArrowRight" : "ArrowDown";
      if (event.key !== backwards && event.key !== forwards) return;
      event.preventDefault(); event.stopPropagation();
      const direction = event.key === forwards ? 1 : -1;
      if (mode === "sense") setPadding(padding() + direction * (menu.autoHide === "end" ? -1 : 1));
      else setBoundary(boundary, barHiddenRange(menu, itemSize)[boundary] + direction * .01);
    }, options);
    return handle;
  });
  overlay.append(preview, before, after, band, sensor, label, ...handles); rail.append(overlay);

  function setBoundary(boundary: "start" | "end", value: number): void {
    const surface = barSurfaceDimensions(menu, itemSize);
    const extent = menu.orientation === "column" ? surface.width : surface.height;
    const minimum = Math.min(1, 4 / extent);
    const range = barHiddenRange(menu, itemSize);
    range[boundary] = boundary === "start"
      ? Math.max(0, Math.min(range.end - minimum, value))
      : Math.min(1, Math.max(range.start + minimum, value));
    menu = { ...menu, autoHideRange: range };
    render(); changed({ autoHideRange: { ...range } });
  }

  function setPadding(value: number): void {
    const { surface, visible } = barHiddenArea(menu, itemSize);
    const maximum = menu.orientation === "column" ? surface.width - (visible.right - visible.left) : surface.height - (visible.bottom - visible.top);
    const autoHidePadding = Math.max(0, Math.min(maximum, value));
    menu = { ...menu, autoHidePadding };
    render(); changed({ autoHidePadding });
  }

  function refreshPreview(): void {
    preview.replaceChildren();
    if (mode !== "sense") return;
    // Keep the real editing canvas anchored; only the inert visual copy slides.
    const copy = rail.cloneNode(false) as HTMLElement;
    copy.removeAttribute("data-hide-range"); copy.removeAttribute("data-spacing");
    copy.classList.add("hide-range-preview-rail");
    copy.style.left = "0"; copy.style.top = "0";
    for (const child of rail.children) {
      if (child.matches(".menu-button, .empty-menu")) copy.append(child.cloneNode(true));
    }
    preview.append(copy);
  }

  function rectInset(rect: Rect, surface: Size): string {
    return `${rect.top}px ${surface.width - rect.right}px ${surface.height - rect.bottom}px ${rect.left}px`;
  }

  function render(): void {
    applyBarHiddenAppearance(rail, menu, itemSize, false);
    overlay.hidden = mode === "off";
    if (mode === "off") rail.removeAttribute("data-hide-range"); else rail.dataset.hideRange = mode;
    const sensing = mode === "sense";
    button.setAttribute("aria-pressed", String(mode !== "off"));
    button.title = t(sensing ? "customize.senseRange" : "customize.hideRange");
    button.ariaLabel = button.title;
    button.replaceChildren(createHideRangeIcon(doc, sensing));
    if (mode === "off") return;
    const horizontal = menu.orientation === "column";
    const range = barHiddenRange(menu, itemSize);
    const surface = barSurfaceDimensions(menu, itemSize);
    const frame = barFrameInsets(menu);
    const { visible, hit, offset } = barHiddenArea(menu, itemSize);
    const extent = horizontal ? surface.width : surface.height;
    const maximumPadding = extent - (horizontal ? visible.right - visible.left : visible.bottom - visible.top);
    overlay.dataset.axis = horizontal ? "x" : "y";
    overlay.style.left = `${-frame.x}px`; overlay.style.top = `${-frame.y}px`;
    overlay.style.width = `${surface.width}px`; overlay.style.height = `${surface.height}px`;
    before.hidden = after.hidden = sensing;
    preview.hidden = sensor.hidden = !sensing;
    label.textContent = t(sensing ? "customize.senseRange" : "customize.hideRange");
    before.style.inset = horizontal ? `0 ${100 - range.start * 100}% 0 0` : `0 0 ${100 - range.start * 100}% 0`;
    after.style.inset = horizontal ? `0 0 0 ${range.end * 100}%` : `${range.end * 100}% 0 0 0`;
    band.style.inset = horizontal ? `0 ${100 - range.end * 100}% 0 ${range.start * 100}%` : `${range.start * 100}% 0 ${100 - range.end * 100}% 0`;
    if (sensing) {
      applyBarHiddenAppearance(preview.firstElementChild as HTMLElement, menu, itemSize, true);
      band.style.inset = rectInset(visible, surface);
      sensor.style.inset = rectInset(hit, surface);
      preview.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
      preview.style.clipPath = `inset(${visible.top - offset.y}px ${surface.width - visible.right + offset.x}px ${surface.height - visible.bottom + offset.y}px ${visible.left - offset.x}px round var(--bar-radius, var(--dock-radius, 7px)))`;
    }
    for (const [index, handle] of handles.entries()) {
      const boundary = index === 0 ? "start" : "end";
      handle.hidden = sensing && boundary !== (menu.autoHide === "end" ? "start" : "end");
      const hitBoundary = horizontal ? index === 0 ? hit.left : hit.right : index === 0 ? hit.top : hit.bottom;
      const coordinate = sensing ? hitBoundary : range[boundary] * extent;
      handle.style.left = horizontal ? `${coordinate}px` : "";
      handle.style.top = horizontal ? "" : `${coordinate}px`;
      handle.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
      handle.setAttribute("aria-valuemin", String(sensing ? 0 : boundary === "start" ? 0 : range.start * 100));
      handle.setAttribute("aria-valuemax", String(sensing ? maximumPadding : boundary === "end" ? 100 : range.end * 100));
      handle.setAttribute("aria-valuenow", String(Math.round(sensing ? padding() : range[boundary] * 100)));
      handle.ariaLabel = `${label.textContent}: ${t(horizontal ? index === 0 ? "expandDirection.left" : "expandDirection.right" : index === 0 ? "expandDirection.up" : "expandDirection.down")}`;
      handle.title = handle.ariaLabel;
    }
  }
  render();
  return {
    get enabled(): boolean { return mode !== "off"; },
    cycle(): void {
      stopGesture?.(); mode = mode === "off" ? "range" : mode === "range" ? "sense" : "off";
      refreshPreview(); render();
    },
    close(): void {
      stopGesture?.(); mode = "off"; refreshPreview(); render();
    },
    update(next: MenuView, size: Size): void {
      if (next.orientation !== menu.orientation || next.autoHide !== menu.autoHide) stopGesture?.();
      menu = next; itemSize = size; refreshPreview(); render();
    },
    stopGesture(): void { stopGesture?.(); },
    destroy(): void { stopGesture?.(); lifetime.abort(); overlay.remove(); rail.removeAttribute("data-hide-range"); },
  };
}

export function createHideRangeIcon(doc: Document, sensing = false): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
  const path = doc.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", sensing ? "M4 4h16v16H4z" : "M4 4h16v16H4zM8 4v16M16 4v16");
  if (sensing) path.setAttribute("stroke-dasharray", "3 2");
  svg.append(path); return svg;
}
