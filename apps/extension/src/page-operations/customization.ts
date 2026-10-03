import { t } from "@browserail/i18n";
import {
  barDimensions, barFrameInsets, barSurfaceDimensions, createCustomizationRail, controlButton, createAnchorIcon, createMoveIcon,
  createCancelIcon, createSaveIcon, nextAnchor, anchorLabel, type BarState,
} from "@browserail/menu-ui";
import type { BrowserMenuPlacement } from "../config";
import { placementAtPoint, placementPoint } from "./placement";

export function mountBrowserCustomization(
  wrapper: HTMLElement, root: HTMLElement, state: BarState, placement: BrowserMenuPlacement,
  save: (placement: BrowserMenuPlacement) => Promise<void>, cancel: () => void,
) {
  const doc = root.ownerDocument;
  const viewport = doc.defaultView!;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  let anchor = placement.anchor;
  let size = barDimensions(state.menu, state.itemSize);
  const frame = barFrameInsets(state.menu);
  const initialSurface = barSurfaceDimensions(state.menu, state.itemSize);
  let point = placementPoint(placement, initialSurface.width, initialSurface.height, viewport.innerWidth, viewport.innerHeight);
  let stopGesture: (() => void) | undefined;
  let saving = false;
  root.className = "browserail-menu-ui customize-mode";
  root.style.flex = "0 0 auto";
  const rail = createCustomizationRail(root, state);
  const content = doc.createElement("div"); content.className = "customize-content";
  const toolbar = doc.createElement("div"); toolbar.className = "customize-toolbar";
  const anchorButton = controlButton(doc, createAnchorIcon(doc, anchor));
  const moveButton = controlButton(doc, createMoveIcon(doc)); moveButton.classList.add("move-handle");
  moveButton.title = t("customize.dragToMove");
  const cancelButton = controlButton(doc, createCancelIcon(doc)); cancelButton.title = t("customize.cancel");
  const saveButton = controlButton(doc, createSaveIcon(doc)); saveButton.title = t("customize.savePlacement");
  toolbar.append(anchorButton, moveButton, cancelButton, saveButton);
  content.append(rail, toolbar);
  root.replaceChildren(content);

  function layout(): void {
    const surfaceWidth = size.width + 2 * frame.x;
    const surfaceHeight = size.height + 2 * frame.y;
    point.x = Math.max(0, Math.min(viewport.innerWidth - surfaceWidth, point.x));
    point.y = Math.max(0, Math.min(viewport.innerHeight - surfaceHeight, point.y));
    rail.style.setProperty("--config-bar-width", `${size.width}px`);
    rail.style.setProperty("--config-bar-height", `${size.height}px`);
    // Keep the rail fixed when the toolbar changes sides near the viewport edge.
    const toolbarSpace = toolbar.getBoundingClientRect().height + 4;
    const above = point.y + surfaceHeight + toolbarSpace > viewport.innerHeight && point.y >= toolbarSpace;
    content.style.flexDirection = above ? "column-reverse" : "column";
    const width = Math.max(surfaceWidth, toolbar.getBoundingClientRect().width);
    point.x = Math.max(0, Math.min(viewport.innerWidth - width, point.x));
    content.style.width = `${width}px`;
    root.style.width = `${width}px`;
    root.style.height = `${surfaceHeight + toolbarSpace}px`;
    wrapper.style.left = `${point.x}px`;
    wrapper.style.top = `${point.y - (above ? toolbarSpace : 0)}px`;
    anchorButton.title = t("customize.anchor", { anchor: anchorLabel(anchor) });
  }
  function beginGesture(element: HTMLElement, event: PointerEvent, move: (event: PointerEvent) => void): void {
    if (event.button !== 0 || saving) return;
    event.preventDefault(); event.stopPropagation(); stopGesture?.();
    element.setPointerCapture(event.pointerId);
    const onMove = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) move(next); };
    const stop = (): void => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      element.removeEventListener("lostpointercapture", stop);
      stopGesture = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    stopGesture = stop;
    element.addEventListener("pointermove", onMove, options);
    element.addEventListener("pointerup", stop, options);
    element.addEventListener("pointercancel", stop, options);
    element.addEventListener("lostpointercapture", stop, options);
  }
  for (const element of [rail, moveButton]) element.addEventListener("pointerdown", event => {
    const start = { ...point };
    const startX = event.clientX, startY = event.clientY;
    beginGesture(element, event, next => {
      point = { x: start.x + next.clientX - startX, y: start.y + next.clientY - startY };
      layout();
    });
  }, options);

  const units = state.menu.items.reduce((sum, item) => sum + (item.kind === "space" ? Math.max(0.1, item.units ?? 1) : 1), 0);
  const count = Math.max(1, Math.round(units));
  const gap = state.menu.gap ?? 4;
  const row = state.menu.orientation === "row";
  const min = barDimensions(state.menu, { width: 26, height: 26 });
  const max = barDimensions(state.menu, { width: row ? 400 : 220, height: row ? 64 : 200 });
  for (const direction of ["north", "east", "south", "west", "southEast"] as const) {
    const handle = doc.createElement("div"); handle.className = `resize-handle resize-${direction}`;
    handle.addEventListener("pointerdown", event => {
      const start = { point: { ...point }, size: { ...size }, x: event.clientX, y: event.clientY };
      beginGesture(handle, event, next => {
        const dx = next.clientX - start.x, dy = next.clientY - start.y;
        if (direction === "east" || direction === "west" || direction === "southEast") {
          size.width = Math.max(min.width, Math.min(max.width, start.size.width + (direction === "west" ? -dx : dx)));
        }
        if (direction === "north" || direction === "south" || direction === "southEast") {
          size.height = Math.max(min.height, Math.min(max.height, start.size.height + (direction === "north" ? -dy : dy)));
        }
        if (direction === "west") point.x = start.point.x + start.size.width - size.width;
        if (direction === "north") point.y = start.point.y + start.size.height - size.height;
        layout();
      });
    }, options);
    rail.append(handle);
  }
  anchorButton.addEventListener("click", () => {
    anchor = nextAnchor(anchor); anchorButton.replaceChildren(createAnchorIcon(doc, anchor)); layout();
  }, options);
  cancelButton.addEventListener("click", cancel, options);
  saveButton.addEventListener("click", () => {
    if (saving) return;
    saving = true; stopGesture?.();
    for (const button of [anchorButton, moveButton, cancelButton, saveButton]) button.disabled = true;
    const draft = placementAtPoint({ ...placement, anchor,
      itemWidth: row ? (size.width - (count - 1) * gap) / count : size.width,
      itemHeight: row ? size.height : (size.height - (count - 1) * gap) / count,
    }, point.x, point.y, size.width + 2 * frame.x, size.height + 2 * frame.y, viewport.innerWidth, viewport.innerHeight);
    void save(draft).catch(error => {
      if (lifetime.signal.aborted) return;
      root.dataset.error = ""; root.title = String(error); saving = false;
      for (const button of [anchorButton, moveButton, cancelButton, saveButton]) button.disabled = false;
    });
  }, options);
  rail.addEventListener("contextmenu", event => event.preventDefault(), options);
  layout();
  return {
    resize: layout,
    destroy(): void { stopGesture?.(); lifetime.abort(); root.classList.remove("customize-mode"); },
  };
}
