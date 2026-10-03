import { barSettingsFromView, isNativeBarSettings, type NativeBarSettings, type MenuPlacement, type MenuView } from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { t } from "@browserail/i18n";
import { createSettingsIcon, applyBarTheme, mountBar, barDimensions, barItemSize, mountSpacingEditor, createSpacingIcon, barFrameInsets, barSurfaceDimensions, createCustomizationRail, controlButton, createAnchorIcon, createSaveIcon, createCancelIcon, nextAnchor, anchorLabel, type BarState, type Controller } from "@browserail/menu-ui";
import { createTauriPopupLink } from "../tauri-popup";

// Desktop→webview projection (see Rust `SurfaceMenu`): render content plus the
// resolved geometry and native edit settings. Runtime visibility and window targets
// stay in Rust; the editor receives attachment and on-top preferences.
type SurfaceMenu = MenuView & { placement: MenuPlacement; attachmentMode: NativeBarSettings["attachmentMode"]; onTopMode: NativeBarSettings["onTopMode"] };

export async function initializeSurface(
  root: HTMLElement,
  query: URLSearchParams,
  applyFontFamily: (fontFamily: string) => void,
): Promise<void> {
  function requiredQuery(name: string): string {
    const value = query.get(name);
    if (!value) {
      throw new Error(`Missing ${name}`);
    }
    return value;
  }

  function showSurfaceError(error: unknown): void {
    root.dataset.error = "";
    root.title = String(error);
  }

  const instanceUid = requiredQuery("instanceUid");
  const menuUid = requiredQuery("menuUid");
  const isFree = query.get("free") === "1";
  const windowUid = isFree ? "" : requiredQuery("windowUid");
  const surfaceLabel = getCurrentWindow().label;
  const initial = isFree
    ? await invoke<SurfaceState>("free_surface_state", { instanceUid, menuUid })
    : await invoke<SurfaceState>("surface_state", { instanceUid, menuUid, surface: "menu", windowUid });
  let fontFamily = initial.fontFamily;
  applyFontFamily(fontFamily);
  document.body.dataset.surface = "menu";
  if (isFree) document.body.dataset.free = "1";
  let customizing = false;
  let editingLocked = await invoke<boolean>("is_editing_locked");
  let currentMenu = initial.menu;
  let customizationStartPosition: SurfacePoint | null = null;
  let menuCollapsed = initial.collapsed ?? false;
  let bar: Controller<BarState> | undefined;
  let cancelActiveCustomization: (() => Promise<void>) | null = null;
  let teardownCustomize: (() => void) | undefined;
  const disposers: Array<() => void> = [];
  const popup = await createTauriPopupLink(root, { instanceUid, menuUid, windowUid, isFree, parentLabel: surfaceLabel });
  const dispatchAction = async (actionUid: string): Promise<void> => {
    if (isFree) await invoke("invoke_free_action", { actionUid, instanceUid, menuUid });
    else await invoke("invoke_action", { actionUid, instanceUid, windowUid, menuUid });
  };
  const report = (action: Promise<void>): void => { void action.catch(showSurfaceError); };
  const closePopup = (): Promise<void> => popup.close();
  function stateFor(menu: SurfaceMenu): BarState {
    return {
      menu, itemSize: { width: menu.placement.itemWidth ?? 84, height: menu.placement.itemHeight ?? 36 },
      collapsed: menuCollapsed, editingLocked, fontFamily,
    };
  }
  function computeMenuDimensions(menu: SurfaceMenu) { return barDimensions(menu, stateFor(menu).itemSize); }
  function computeSurfaceDimensions(menu: SurfaceMenu) {
    return barSurfaceDimensions(menu, stateFor(menu).itemSize, menuCollapsed);
  }
  async function renderSurface(menu: SurfaceMenu): Promise<void> {
    const state = stateFor(menu);
    root.classList.remove("customize-mode");
    if (bar) await bar.update(state);
    else {
      bar = mountBar(root, state, {
        invokeAction: dispatchAction,
        requestToggleFold: async () => {
          const before = root.querySelector<HTMLElement>(".menu-toggle-button");
          if (!before) return;
          const beforeAnchor = elementOrigin(before);
          menuCollapsed = await invoke<boolean>("toggle_menu_collapsed", { instanceUid, menuUid });
          if (!currentMenu) return;
          await renderSurface(currentMenu);
          const after = root.querySelector<HTMLElement>(".menu-toggle-button");
          if (!after) return;
          const size = computeSurfaceDimensions(currentMenu);
          await resizeAndPosition(beforeAnchor, elementOrigin(after), size.width, size.height);
        },
        requestTemporarySave: input => invoke("open_temporary_confirmation", {
          instanceUid, menuUid, windowUid: isFree ? null : windowUid, ...input,
        }),
        openPopup: request => popup.open(request),
        requestCustomize: enterCustomization,
      });
      await bar.ready;
    }
  }
  disposers.push(await listen<MenuStateEvent>("menu-state", ({ payload }) => {
    if (payload.instanceUid !== instanceUid || payload.windowUid !== (isFree ? null : windowUid)
      || payload.menu?.uid !== menuUid || customizing) return;
    currentMenu = payload.menu;
    menuCollapsed = payload.collapsed ?? menuCollapsed;
    report(renderSurface(payload.menu));
  }, { target: surfaceLabel }));
  disposers.push(await listen<boolean>("editing-lock-changed", ({ payload }) => {
    editingLocked = payload;
    if (payload && customizing && cancelActiveCustomization) report(cancelActiveCustomization());
    else if (currentMenu && !customizing) report(renderSurface(currentMenu));
  }));
  disposers.push(await listen<string>("font-family-changed", ({ payload }) => {
    fontFamily = payload;
    applyFontFamily(payload);
    if (currentMenu && !customizing) report(renderSurface(currentMenu));
  }));
  window.addEventListener("pagehide", () => {
    bar?.destroy();
    teardownCustomize?.();
    for (const dispose of disposers) dispose();
    popup.destroy();
  }, { once: true });
  if (currentMenu) await renderSurface(currentMenu);

  interface SurfacePoint {
    x: number;
    y: number;
  }

  function elementOrigin(element: HTMLElement): SurfacePoint {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  function requestDoubleAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  async function windowOrigin(): Promise<SurfacePoint> {
    const appWindow = getCurrentWindow();
    const [position, scale] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.scaleFactor(),
    ]);
    return { x: position.x / scale, y: position.y / scale };
  }

  async function resizeAndPosition(
    fromAnchor: SurfacePoint,
    toAnchor: SurfacePoint,
    width: number,
    height: number,
  ): Promise<void> {
    await invoke("resize_and_position", {
      fromAnchorX: fromAnchor.x,
      fromAnchorY: fromAnchor.y,
      height: Math.ceil(height),
      toAnchorX: toAnchor.x,
      toAnchorY: toAnchor.y,
      width: Math.ceil(width),
    });
  }

  async function enterCustomization(): Promise<void> {
    const menu = currentMenu;
    if (!menu || menuCollapsed) return;
    if (customizing) return;
    // If a popup is open, close it and wait for size and position to restore completely before customizing.
    await closePopup();
    const menuBar = root.querySelector<HTMLElement>(".menu-bar");
    if (!menuBar) return;

    const fromAnchor = elementOrigin(menuBar);
    const menuHeight = menuBar.getBoundingClientRect().height;
    customizationStartPosition = await windowOrigin();
    customizing = true;
    const menuToCustomize = currentMenu ?? menu;
    const toolbar = renderCustomize(menuToCustomize);
    const toolbarSpace = customizationToolbarSpace(toolbar, menuToCustomize);
    await invoke<{ toolbarPosition: "top" | "bottom" }>("begin_menu_customization", {
      anchorOffsetY: fromAnchor.y,
      instanceUid,
      menuHeight,
      menuUid,
      toolbarSpace,
      windowUid,
    })
      .then(async (info) => {
        if (info?.toolbarPosition === "top") {
          renderCustomize(menuToCustomize, "top");
        }
        const rail = root.querySelector<HTMLElement>(".customize-rail");
        const content = root.querySelector<HTMLElement>(".customize-content");
        if (!rail || !content) return;
        const contentRect = content.getBoundingClientRect();
        await resizeAndPosition(
          fromAnchor,
          elementOrigin(rail),
          contentRect.width,
          contentRect.height,
        );
        delete root.dataset.error;
        root.removeAttribute("title");
      })
      .catch(async (err) => {
        customizing = false;
        customizationStartPosition = null;
        await renderSurface(menuToCustomize);
        showSurfaceError(err);
      });
  }

  function customizationToolbarSpace(toolbar: HTMLElement, menu: SurfaceMenu): number {
    const container = toolbar.parentElement ?? root;
    const rowGap = Number.parseFloat(getComputedStyle(container).rowGap);
    const gap = Number.isFinite(rowGap) ? rowGap : 0;
    return Math.ceil(toolbar.getBoundingClientRect().height + gap + 2 * barFrameInsets(menu).y);
  }

  function renderCustomize(
    menu: SurfaceMenu,
    toolbarPosition: "top" | "bottom" = "bottom",
  ): HTMLElement {
    teardownCustomize?.();
    teardownCustomize = undefined;
    let settings: NativeBarSettings = { ...barSettingsFromView(menu), attachmentMode: menu.attachmentMode, onTopMode: menu.onTopMode };
    let anchor = menu.placement.boundPosition.anchor;
    const initialDims = computeMenuDimensions(menu);
    let targetWidth = initialDims.width;
    let targetHeight = initialDims.height;
    let toolbarSide: "top" | "bottom" = toolbarPosition;
    bar?.destroy();
    bar = undefined;
    root.className = "browserail-menu-ui customize-mode";
    root.dataset.toolbarPosition = toolbarSide;
    root.dataset.orientation = menu.orientation;
    root.onpointerdown = null;

    const railContainer = createCustomizationRail(root, stateFor(menu));

    railContainer.addEventListener("pointerdown", (event) => {
      if (event.button === 0 && !spacingEditor.enabled) {
        event.preventDefault();
        void invoke("start_menu_drag");
      }
    });

    const toolbar = document.createElement("div");
    toolbar.className = "customize-toolbar";

    const content = document.createElement("div");
    content.className = "customize-content";

    const anchorButton = controlButton(document, createAnchorIcon(document, anchor));
    anchorButton.title = t("customize.anchor", { anchor: anchorLabel(anchor) });
    anchorButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        anchor = nextAnchor(anchor);
        anchorButton.replaceChildren(createAnchorIcon(document, anchor));
        anchorButton.title = t("customize.anchor", { anchor: anchorLabel(anchor) });
      }
    });

    const cancelButton = controlButton(document, createCancelIcon(document));
    cancelButton.title = t("customize.cancel");
    cancelButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void cancelCustomization();
      }
    });

    const saveButton = controlButton(document, createSaveIcon(document));
    saveButton.title = t("customize.savePlacement");
    saveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void saveCustomization();
      }
    });

    const spacingButton = controlButton(document, createSpacingIcon(document));
    spacingButton.title = t("customize.adjustSpacing");
    spacingButton.setAttribute("aria-pressed", "false");
    const spacingEditor = mountSpacingEditor(railContainer, menu, stateFor(menu).itemSize, (draft, itemSize) => {
      const fromAnchor = elementOrigin(railContainer);
      const dimensions = barDimensions(draft, itemSize);
      targetWidth = dimensions.width;
      targetHeight = dimensions.height;
      applyTargetSize();
      resizeNativeCanvas(fromAnchor, elementOrigin(railContainer));
    });
    spacingButton.addEventListener("click", () => {
      stopActiveResize?.();
      spacingEditor.setEnabled(!spacingEditor.enabled);
      spacingButton.setAttribute("aria-pressed", String(spacingEditor.enabled));
    });

    const settingsButton = controlButton(document, createSettingsIcon(document));
    settingsButton.title = t("bar.settings");
    settingsButton.disabled = true;
    let settingsWindowLabel: string | undefined;
    settingsButton.addEventListener("click", () => {
      report(invoke<string>("open_bar_settings", { instanceUid, settings, itemHeight: spacingEditor.itemSize.height, title: t("bar.settings") }).then(label => {
        if (!customizeAlive) return;
        settingsWindowLabel = label;
        return emitTo(label, "bar-settings-item-height", spacingEditor.itemSize.height);
      }));
    });
    let unlistenSettings: (() => void) | undefined;
    void listen<NativeBarSettings>("bar-settings-draft", ({ payload }) => {
      if (!customizeAlive || saving || !isNativeBarSettings(payload)) return;
      settings = payload;
      stopActiveResize?.();
      spacingEditor.setSettings(settings);
    }).then(unlisten => { if (customizeAlive) { unlistenSettings = unlisten; settingsButton.disabled = false; } else unlisten(); });

    // A free (detached) menu has no owner window to anchor against — hide that
    // control so the toolbar only shows actions that make sense off-window.
    const toolsRow = document.createElement("div");
    toolsRow.className = "customize-toolbar-row";
    const actionsRow = document.createElement("div");
    actionsRow.className = "customize-toolbar-row";
    if (!isFree) toolsRow.append(anchorButton);
    toolsRow.append(spacingButton, settingsButton);
    actionsRow.append(cancelButton, saveButton);
    toolbar.append(toolsRow, actionsRow);

    const clampWidth = (width: number): number => {
      const min = barDimensions(spacingEditor.menu, { width: 26, height: 26 }).width;
      const max = barDimensions(spacingEditor.menu, { width: spacingEditor.menu.orientation === "row" ? 400 : 220, height: 200 }).width;
      return Math.min(max, Math.max(min, width));
    };
    const clampHeight = (height: number): number => {
      const min = barDimensions(spacingEditor.menu, { width: 26, height: 26 }).height;
      const max = barDimensions(spacingEditor.menu, { width: 400, height: spacingEditor.menu.orientation === "row" ? 64 : 200 }).height;
      return Math.min(max, Math.max(min, height));
    };

    function applyTargetSize(): void {
      if (settingsWindowLabel) report(emitTo(settingsWindowLabel, "bar-settings-item-height", spacingEditor.itemSize.height));
      const theme = applyBarTheme(root, { ...stateFor(menu), menu: spacingEditor.menu, itemSize: spacingEditor.itemSize });
      railContainer.style.setProperty("--config-bar-font-size", `${theme.buttonFontSize}px`);
      const toolbarWidth = Math.ceil(toolbar.scrollWidth);
      const frame = barFrameInsets(spacingEditor.menu);
      content.style.width = `${Math.max(targetWidth + 2 * frame.x, toolbarWidth)}px`;
      railContainer.style.setProperty("--config-bar-width", `${targetWidth}px`);
      railContainer.style.setProperty("--config-bar-height", `${targetHeight}px`);
    }

    let resizeFrame: number | undefined;
    let stopActiveResize: (() => void) | undefined;
    let pendingFromAnchor: SurfacePoint | undefined;
    let pendingToAnchor: SurfacePoint | undefined;
    function resizeNativeCanvas(fromAnchor: SurfacePoint, toAnchor: SurfacePoint): void {
      pendingFromAnchor ??= fromAnchor;
      pendingToAnchor = toAnchor;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        const from = pendingFromAnchor;
        const to = pendingToAnchor;
        pendingFromAnchor = undefined;
        pendingToAnchor = undefined;
        if (!from || !to) return;
        const rect = content.getBoundingClientRect();
        void resizeAndPosition(from, to, rect.width, rect.height);
      });
    }

    function resizeHandle(direction: "north" | "east" | "south" | "west" | "southEast"): HTMLElement {
      const handle = document.createElement("div");
      handle.className = `resize-handle resize-${direction}`;
      const currentResizeAnchor = (): SurfacePoint => {
        const rect = railContainer.getBoundingClientRect();
        if (direction === "north") return { x: rect.left, y: rect.bottom };
        if (direction === "west") return { x: rect.right, y: rect.top };
        return { x: rect.left, y: rect.top };
      };
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || spacingEditor.enabled) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        const startX = event.screenX;
        const startY = event.screenY;
        const startWidth = targetWidth;
        const startHeight = targetHeight;
        handle.setPointerCapture(event.pointerId);

        const move = (moveEvent: PointerEvent): void => {
          const fromResizeAnchor = currentResizeAnchor();
          if (direction === "east" || direction === "southEast") {
            targetWidth = clampWidth(startWidth + moveEvent.screenX - startX);
          }
          if (direction === "west") {
            targetWidth = clampWidth(startWidth - (moveEvent.screenX - startX));
          }
          if (direction === "south" || direction === "southEast") {
            targetHeight = clampHeight(startHeight + moveEvent.screenY - startY);
          }
          if (direction === "north") {
            targetHeight = clampHeight(startHeight - (moveEvent.screenY - startY));
          }
          spacingEditor.setItemSize(barItemSize(spacingEditor.menu, { width: targetWidth, height: targetHeight }));
          applyTargetSize();
          const toResizeAnchor = currentResizeAnchor();
          resizeNativeCanvas(fromResizeAnchor, toResizeAnchor);
        };
        const stop = (): void => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
          if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
          stopActiveResize = undefined;
        };
        stopActiveResize?.();
        stopActiveResize = stop;

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      });
      return handle;
    }

    railContainer.append(
      resizeHandle("north"),
      resizeHandle("east"),
      resizeHandle("south"),
      resizeHandle("west"),
      resizeHandle("southEast"),
    );

    // Order the toolbar against the rail. Re-ordering preserves the rail's on-
    // screen position (see maybeFlipToolbarSide), so a flip only moves the
    // toolbar to the other edge.
    const layoutForToolbarSide = (side: "top" | "bottom"): void => {
      toolbarSide = side;
      root.dataset.toolbarPosition = side;
      if (side === "top") {
        content.replaceChildren(toolbar, railContainer);
      } else {
        content.replaceChildren(railContainer, toolbar);
      }
      applyTargetSize();
    };
    layoutForToolbarSide(toolbarPosition);
    root.replaceChildren(content);
    applyTargetSize();

    // While the window is dragged, re-check which edge has room for the toolbar.
    // Dragging the bar past the screen edge would push the toolbar off-screen;
    // when that happens we flip sides and re-anchor so the rail stays put and the
    // toolbar jumps to the opposite edge, keeping save/cancel reachable.
    const appWindow = getCurrentWindow();
    let flipCheckTimer: ReturnType<typeof setTimeout> | undefined;
    let flipInFlight = false;
    async function maybeFlipToolbarSide(): Promise<void> {
      if (saving || !customizeAlive || flipInFlight || !root.isConnected) return;
      const railRect = railContainer.getBoundingClientRect();
      let side: "top" | "bottom";
      try {
        side = await invoke<"top" | "bottom">("customization_toolbar_flip", {
          anchorOffsetY: railRect.top,
          current: toolbarSide,
          menuHeight: railRect.height,
          toolbarSpace: customizationToolbarSpace(toolbar, { ...menu, ...settings }),
        });
      } catch {
        return;
      }
      if (saving || !customizeAlive || side === toolbarSide || !root.isConnected) return;

      flipInFlight = true;
      try {
        const beforeRail = elementOrigin(railContainer);
        layoutForToolbarSide(side);
        await requestDoubleAnimationFrame();
        const contentRect = content.getBoundingClientRect();
        await resizeAndPosition(
          beforeRail,
          elementOrigin(railContainer),
          contentRect.width,
          contentRect.height,
        );
      } catch {
        // Ignore: the next move event will retry.
      } finally {
        flipInFlight = false;
      }
    }
    let unlistenMoved: (() => void) | undefined;
    let customizeAlive = true;
    teardownCustomize = () => {
      customizeAlive = false;
      settingsWindowLabel = undefined;
      unlistenSettings?.();
      report(invoke("close_bar_settings", { instanceUid }));
      spacingEditor.destroy();
      stopActiveResize?.();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      clearTimeout(flipCheckTimer);
      unlistenMoved?.();
      unlistenMoved = undefined;
    };
    void appWindow
      .onMoved(() => {
        clearTimeout(flipCheckTimer);
        flipCheckTimer = setTimeout(() => {
          void maybeFlipToolbarSide();
        }, 200);
      })
      .then((unlisten) => {
        if (customizeAlive) unlistenMoved = unlisten;
        else unlisten();
      });

    async function cancelCustomization(): Promise<void> {
      cancelActiveCustomization = null;
      const restorePosition = customizationStartPosition;
      customizing = false;
      teardownCustomize?.();
      await invoke("cancel_menu_customization", { instanceUid, menuUid, windowUid });
      if (currentMenu) {
        await renderSurface(currentMenu);
        const menuBar = root.querySelector<HTMLElement>(".menu-bar");
        if (menuBar) {
          const { width, height } = computeSurfaceDimensions(currentMenu);
          if (restorePosition) {
            const currentPosition = await windowOrigin();
            await resizeAndPosition(
              {
                x: restorePosition.x - currentPosition.x,
                y: restorePosition.y - currentPosition.y,
              },
              { x: 0, y: 0 },
              width,
              height,
            );
          }
        }
      }
      customizationStartPosition = null;
    }

    let saving = false;
    async function saveCustomization(): Promise<void> {
      if (saving) return;
      saving = true;
      clearTimeout(flipCheckTimer);
      stopActiveResize?.();
      spacingEditor.stopGesture();
      railContainer.inert = true;
      const spacing = spacingEditor.spacing;
      const itemSize = spacingEditor.itemSize;
      const controls = [anchorButton, spacingButton, settingsButton, cancelButton, saveButton];
      for (const button of controls) button.disabled = true;
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = undefined;
      const pendingFrom = pendingFromAnchor, pendingTo = pendingToAnchor;
      pendingFromAnchor = pendingToAnchor = undefined;
      try {
        if (pendingFrom && pendingTo) {
          const rect = content.getBoundingClientRect();
          await resizeAndPosition(pendingFrom, pendingTo, rect.width, rect.height);
        }
        const fromAnchor = elementOrigin(railContainer);
        const placement = await invoke<MenuPlacement>("save_menu_placement", {
          anchor,
          anchorOffsetX: fromAnchor.x,
          anchorOffsetY: fromAnchor.y,
          height: targetHeight,
          itemWidth: itemSize.width,
          itemHeight: itemSize.height,
          spacing,
          settings,
          instanceUid,
          menuUid,
          width: targetWidth,
          windowUid,
        });
        cancelActiveCustomization = null;
        teardownCustomize?.();
        customizing = false;
        customizationStartPosition = null;
        if (currentMenu) {
          currentMenu = { ...currentMenu, ...settings, ...spacing, placement };
          await renderSurface(currentMenu);
        }
      } catch (error) {
        saving = false;
        railContainer.inert = false;
        for (const button of controls) button.disabled = false;
        showSurfaceError(error);
      }
    }

    // Expose the cancel hook so leaving edit mode mid-customize discards it.
    cancelActiveCustomization = cancelCustomization;

    return toolbar;
  }
}

interface SurfaceState {
  kind: "menu";
  menu?: SurfaceMenu;
  collapsed?: boolean;
  fontFamily: string;
}

interface MenuStateEvent {
  instanceUid: string;
  windowUid?: string | null;
  menu?: SurfaceMenu;
  collapsed?: boolean;
}
