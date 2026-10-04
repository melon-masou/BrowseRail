import { t } from "@browserail/i18n";
import {
  applyBarTheme, resolveFontFamily, mountBarSettings, placeBarSettings, createSettingsIcon, barDimensions, barItemSize, mountSpacingEditor, createSpacingIcon, barFrameInsets, barSurfaceDimensions, createCustomizationRail, controlButton, createAnchorIcon,
  createCancelIcon, createSaveIcon, createOrientationControl, nextAnchor, anchorLabel, type BarState,
} from "@browserail/menu-ui";
import { barSettingsFromView, type BarSettings, type BarSettingsGroup, type MenuSpacing } from "@browserail/protocol";
import type { BrowserMenuPlacement } from "../config";
import { placementAtPoint, placementPoint } from "./placement";

export function mountBrowserCustomization(
  wrapper: HTMLElement, root: HTMLElement, state: BarState, placement: BrowserMenuPlacement,
  save: (placement: BrowserMenuPlacement, spacing: MenuSpacing, settings: BarSettings, applyToAll: BarSettingsGroup[]) => Promise<void>, cancel: () => void,
) {
  const doc = root.ownerDocument;
  const viewport = doc.defaultView!;
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  let settings: BarSettings = barSettingsFromView(state.menu);
  let applyToAll: BarSettingsGroup[] = [];
  let anchor = placement.anchor;
  let size = barDimensions(state.menu, state.itemSize);
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
  const cancelButton = controlButton(doc, createCancelIcon(doc)); cancelButton.title = t("customize.cancel");
  const saveButton = controlButton(doc, createSaveIcon(doc)); saveButton.title = t("customize.savePlacement");
  const spacingButton = controlButton(doc, createSpacingIcon(doc));
  spacingButton.title = t("customize.adjustSpacing");
  spacingButton.setAttribute("aria-pressed", "false");
  const settingsButton = controlButton(doc, createSettingsIcon(doc)); settingsButton.title = t("bar.settings");
  const orientationControl = createOrientationControl(doc, settings.orientation, orientation => {
    stopGesture?.(); settings = { ...settings, orientation }; spacingEditor.setSettings(settings);
  });
  const toolsRow = doc.createElement("div"); toolsRow.className = "customize-toolbar-row";
  const actionsRow = doc.createElement("div"); actionsRow.className = "customize-toolbar-row";
  toolsRow.append(anchorButton, orientationControl.button, spacingButton, settingsButton);
  actionsRow.append(cancelButton, saveButton);
  toolbar.append(toolsRow, actionsRow);
  content.append(rail, toolbar);
  root.replaceChildren(content);

  const spacingEditor = mountSpacingEditor(rail, state.menu, state.itemSize, (menu, itemSize) => {
    size = barDimensions(menu, itemSize);
    layout();
  });
  spacingButton.addEventListener("click", () => {
    stopGesture?.();
    spacingEditor.setEnabled(!spacingEditor.enabled);
    spacingButton.setAttribute("aria-pressed", String(spacingEditor.enabled));
  }, options);
  const settingsPopup = doc.createElement("div"); settingsPopup.className = "bar-settings-popup"; settingsPopup.hidden = true;
  const header = doc.createElement("header");
  const title = doc.createElement("strong"); title.textContent = t("bar.settings");
  const close = doc.createElement("button"); close.type = "button"; close.textContent = "✕"; close.title = t("common.close");
  header.append(title, close);
  const settingsForm = doc.createElement("div");
  settingsPopup.append(header, settingsForm); wrapper.append(settingsPopup);
  const settingsController = mountBarSettings(settingsForm, settings, (next, groups) => {
    stopGesture?.(); settings = next; applyToAll = groups;
    spacingEditor.setSettings(next);
  }, spacingEditor.itemSize.height);
  settingsPopup.classList.add("bar-settings");
  close.addEventListener("click", () => { settingsPopup.hidden = true; }, options);
  settingsButton.addEventListener("click", () => { settingsPopup.hidden = !settingsPopup.hidden; layout(); }, options);
  function layout(): void {
    settingsController.updateOrientation(spacingEditor.menu.orientation);
    orientationControl.update(spacingEditor.menu.orientation);
    settingsController.updateItemHeight(spacingEditor.itemSize.height);
    const theme = applyBarTheme(root, { ...state, menu: spacingEditor.menu, itemSize: spacingEditor.itemSize, fontFamily: resolveFontFamily(spacingEditor.menu.fontFamily) });
    rail.style.setProperty("--config-bar-font-size", `${theme.buttonFontSize}px`);
    const frame = barFrameInsets(spacingEditor.menu);
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
    if (!settingsPopup.hidden) {
      const position = placeBarSettings(root.getBoundingClientRect(),
        { width: settingsPopup.offsetWidth, height: settingsPopup.offsetHeight },
        { left: 8, top: 8, right: viewport.innerWidth - 8, bottom: viewport.innerHeight - 8 }, spacingEditor.menu.orientation);
      settingsPopup.style.left = `${position.x}px`;
      settingsPopup.style.top = `${position.y}px`;
    }

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
  rail.addEventListener("pointerdown", event => {
    if (spacingEditor.enabled) return;
    const start = { ...point };
    const startX = event.clientX, startY = event.clientY;
    beginGesture(rail, event, next => {
      point = { x: start.x + next.clientX - startX, y: start.y + next.clientY - startY };
      layout();
    });
  }, options);

  for (const direction of ["north", "east", "south", "west", "southEast"] as const) {
    const handle = doc.createElement("div"); handle.className = `resize-handle resize-${direction}`;
    handle.addEventListener("pointerdown", event => {
      if (spacingEditor.enabled) return;
      const row = spacingEditor.menu.orientation === "row";
      const min = barDimensions(spacingEditor.menu, { width: 26, height: 26 });
      const max = barDimensions(spacingEditor.menu, { width: row ? 400 : 220, height: row ? 64 : 200 });
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
        spacingEditor.setItemSize(barItemSize(spacingEditor.menu, size));
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
    saving = true; stopGesture?.(); spacingEditor.stopGesture(); rail.inert = true;
    for (const button of [anchorButton, orientationControl.button, spacingButton, settingsButton, cancelButton, saveButton]) button.disabled = true;
    const frame = barFrameInsets(spacingEditor.menu);
    const draft = placementAtPoint({ ...placement, anchor,
      itemWidth: spacingEditor.itemSize.width,
      itemHeight: spacingEditor.itemSize.height,
    }, point.x, point.y, size.width + 2 * frame.x, size.height + 2 * frame.y, viewport.innerWidth, viewport.innerHeight);
    settingsPopup.hidden = true;
    void save(draft, spacingEditor.spacing, settings, applyToAll).catch(error => {
      if (lifetime.signal.aborted) return;
      root.dataset.error = ""; root.title = String(error); saving = false; rail.inert = false;
      for (const button of [anchorButton, orientationControl.button, spacingButton, settingsButton, cancelButton, saveButton]) button.disabled = false;
    });
  }, options);
  rail.addEventListener("contextmenu", event => event.preventDefault(), options);
  layout();
  return {
    resize: layout,
    destroy(): void { stopGesture?.(); settingsController.destroy(); settingsPopup.remove(); spacingEditor.destroy(); lifetime.abort(); root.classList.remove("customize-mode"); },
  };
}
