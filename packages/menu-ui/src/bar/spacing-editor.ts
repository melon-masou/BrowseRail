import { t } from "@browserail/i18n";
import { normalizeMenuSpacing, type MenuSpacing, type MenuView } from "@browserail/protocol";
import { applyBarLayout, barOffsets, gapRatioAfter } from "../layout";
import type { Size } from "../types";

export function mountSpacingEditor(
  rail: HTMLElement,
  initialMenu: MenuView,
  initialSize: Size,
  onChange: (menu: MenuView, itemSize: Size) => void,
) {
  const menu = { ...initialMenu, ...normalizeMenuSpacing(initialMenu) };
  menu.extraGaps = Object.assign(Object.create(null) as Record<string, number>, menu.extraGaps);
  let itemSize = { ...initialSize };
  let enabled = false;
  let stopGesture: (() => void) | undefined;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const row = menu.orientation === "row";
  const handles = menu.items.slice(0, -1).map((entry, index) => {
    const handle = rail.ownerDocument.createElement("div");
    handle.className = "gap-handle";
    handle.title = t("customize.spacingHint");
    handle.addEventListener("contextmenu", event => event.preventDefault(), options);
    handle.addEventListener("pointerdown", event => {
      if (!enabled || (event.button !== 0 && event.button !== 2) || !entry.layoutId) return;
      event.preventDefault();
      event.stopPropagation();
      stopGesture?.();
      const global = event.button === 2;
      const start = global ? menu.gapRatio : menu.extraGaps[entry.layoutId] ?? 0;
      const position = row ? event.screenX : event.screenY;
      const dimension = row ? itemSize.width : itemSize.height;
      // A global drag changes the bar length once, spread across all gaps.
      const dragScale = global ? Math.max(1, handles.length) : 1;
      handle.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent): void => {
        if (next.pointerId !== event.pointerId) return;
        const ratio = Math.max(0, start + ((row ? next.screenX : next.screenY) - position) / (dimension * dragScale));
        if (global) menu.gapRatio = ratio;
        else if (ratio === 0) delete menu.extraGaps[entry.layoutId!];
        else menu.extraGaps[entry.layoutId!] = ratio;
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
      if (!enabled || !entry.layoutId) return;
      delete menu.extraGaps[entry.layoutId];
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
    for (const { handle, index } of handles) {
      handle.hidden = !enabled;
      const center = offsets[index]! + dimension * (1 + gapRatioAfter(menu, index) / 2);
      handle.style[row ? "left" : "top"] = `${center}px`;
    }
  }
  render();
  return {
    get enabled(): boolean { return enabled; },
    get menu(): MenuView { return menu; },
    get itemSize(): Size { return { ...itemSize }; },
    get spacing(): MenuSpacing { return normalizeMenuSpacing(menu); },
    setEnabled(next: boolean): void {
      stopGesture?.();
      enabled = next;
      rail.toggleAttribute("data-spacing", enabled);
      render();
    },
    setItemSize(next: Size): void { itemSize = { ...next }; render(); },
    stopGesture(): void { stopGesture?.(); },
    destroy(): void {
      stopGesture?.();
      lifetime.abort();
      for (const { handle } of handles) handle.remove();
      rail.removeAttribute("data-spacing");
    },
  };
}
