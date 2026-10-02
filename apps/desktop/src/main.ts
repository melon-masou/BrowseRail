import {
  type MenuPlacement,
  type MenuView,
} from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getLanguage, type Lang, LANGUAGES, onLanguageChange, saveLanguage, t } from "@browserail/i18n";
import { initializePopupSurface } from "./popup-surface";
import { mountBar, barDimensions, createCustomizationRail, controlButton, createAnchorIcon, createMoveIcon, createSaveIcon, createCancelIcon, nextAnchor, anchorLabel, type BarState, type Controller } from "@browserail/menu-ui";
import { createTauriPopupLink } from "./tauri-popup";
import "@browserail/menu-ui/styles.css";
import { initializeTemporaryConfirmation } from "./temporary-confirm";
import { showWindowWhenReady } from "./window-ready";
import "./styles.css";

// Desktop→webview projection (see Rust `SurfaceMenu`): render content plus the
// resolved geometry the surface lays itself out from. The webview reads view
// fields (flattened) and `placement`; it never sees native props or target.
type SurfaceMenu = MenuView & { placement: MenuPlacement };

const root = requiredElement("app");
const query = new URLSearchParams(location.search);
function applyFontFamily(fontFamily: string): void {
  document.documentElement.style.setProperty("--desktop-font-family", fontFamily);
}

// Keep the Rust-rendered tray/menu and window titles in this webview's language.
void invoke("set_ui_language", { language: getLanguage() }).catch(() => {});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
}, true);
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
}, true);

if (query.get("view") === "host") {
  document.body.replaceChildren();
} else if (query.get("view") === "settings") {
  void initializeListenerSettings();
} else if (query.get("view") === "temporaryConfirm") {
  initializeTemporaryConfirmation(root);
} else if (query.get("surface") === "popup") {
  void initializePopupSurface();
} else {
  void initializeSurface();
}

async function initializeSurface(): Promise<void> {
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
    if (menuCollapsed) return stateFor(menu).itemSize;
    return computeMenuDimensions(menu);
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
    const toolbarSpace = customizationToolbarSpace(toolbar);
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

  function customizationToolbarSpace(toolbar: HTMLElement): number {
    const container = toolbar.parentElement ?? root;
    const rowGap = Number.parseFloat(getComputedStyle(container).rowGap);
    const gap = Number.isFinite(rowGap) ? rowGap : 0;
    return Math.ceil(toolbar.getBoundingClientRect().height + gap);
  }

  function renderCustomize(
    menu: SurfaceMenu,
    toolbarPosition: "top" | "bottom" = "bottom",
  ): HTMLElement {
    teardownCustomize?.();
    teardownCustomize = undefined;
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
      if (event.button === 0) {
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

    const moveButton = controlButton(document, createMoveIcon(document));
    moveButton.title = t("customize.dragToMove");
    moveButton.classList.add("move-handle");
    moveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
        void invoke("start_menu_drag");
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

    // A free (detached) menu has no owner window to anchor against — hide that
    // control so the toolbar only shows actions that make sense off-window.
    if (isFree) {
      toolbar.append(moveButton, cancelButton, saveButton);
    } else {
      toolbar.append(anchorButton, moveButton, cancelButton, saveButton);
    }

    const clampWidth = (width: number): number => menu.orientation === "column"
      ? Math.min(220, Math.max(26, width))
      : Math.min(2_000, Math.max(26, width));
    const clampHeight = (height: number): number => menu.orientation === "row"
      ? Math.min(64, Math.max(26, height))
      : Math.min(1_600, Math.max(26, height));

    function applyTargetSize(): void {
      const toolbarWidth = Math.ceil(toolbar.scrollWidth);
      content.style.width = `${Math.max(targetWidth, toolbarWidth)}px`;
      railContainer.style.width = `${targetWidth}px`;
      railContainer.style.height = `${targetHeight}px`;
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
        if (event.button !== 0) {
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
      if (flipInFlight || !root.isConnected) return;
      const railRect = railContainer.getBoundingClientRect();
      let side: "top" | "bottom";
      try {
        side = await invoke<"top" | "bottom">("customization_toolbar_flip", {
          anchorOffsetY: railRect.top,
          current: toolbarSide,
          menuHeight: railRect.height,
          toolbarSpace: customizationToolbarSpace(toolbar),
        });
      } catch {
        return;
      }
      if (side === toolbarSide || !root.isConnected) return;

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

    async function saveCustomization(): Promise<void> {
      cancelActiveCustomization = null;
      teardownCustomize?.();
      const fromAnchor = elementOrigin(railContainer);
      const placement = await invoke<MenuPlacement>("save_menu_placement", {
        anchor,
        anchorOffsetX: fromAnchor.x,
        anchorOffsetY: fromAnchor.y,
        height: targetHeight,
        instanceUid,
        menuUid,
        width: targetWidth,
        windowUid,
      });
      customizing = false;
      customizationStartPosition = null;
      if (currentMenu) {
        currentMenu = { ...currentMenu, placement };
        await renderSurface(currentMenu);
        const menuBar = root.querySelector<HTMLElement>(".menu-bar");
        if (menuBar) {
          const { width, height } = computeSurfaceDimensions(currentMenu);
          await resizeAndPosition(fromAnchor, elementOrigin(menuBar), width, height);
        }
      }
    }

    // Expose the cancel hook so leaving edit mode mid-customize discards it.
    cancelActiveCustomization = cancelCustomization;

    return toolbar;
  }
}
function showSurfaceError(error: unknown): void {
  root.dataset.error = "";
  root.title = String(error);
}

async function initializeListenerSettings(): Promise<void> {
  document.body.dataset.view = "settings";
  root.className = "listener-settings";

  const portSection = document.createElement("div");
  portSection.className = "settings-section";

  const portLabel = document.createElement("label");
  portLabel.className = "settings-label";
  portLabel.htmlFor = "settings-port-input";
  portLabel.textContent = t("settings.listenPort");

  const portRow = document.createElement("form");
  portRow.className = "settings-inline-row";

  const portInput = document.createElement("input");
  portInput.id = "settings-port-input";
  portInput.type = "number";
  portInput.min = "1";
  portInput.max = "65535";
  portInput.required = true;

  const applyBtn = document.createElement("button");
  applyBtn.type = "submit";
  applyBtn.textContent = t("settings.apply");

  portRow.append(portInput, applyBtn);
  portSection.append(portLabel, portRow);

  const debugSection = document.createElement("div");
  debugSection.className = "settings-section";

  const debugLabel = document.createElement("label");
  debugLabel.className = "settings-checkbox-row";

  const debugCheckbox = document.createElement("input");
  debugCheckbox.type = "checkbox";
  debugCheckbox.id = "settings-debug-checkbox";

  const debugText = document.createElement("span");
  debugText.textContent = t("settings.debug");

  debugLabel.append(debugCheckbox, debugText);
  debugSection.append(debugLabel);

  const fontSection = document.createElement("div");
  fontSection.className = "settings-section";

  const fontLabel = document.createElement("label");
  fontLabel.className = "settings-label";
  fontLabel.htmlFor = "settings-font-input";
  fontLabel.textContent = t("settings.fontFamily");

  const fontSelect = document.createElement("select");
  fontSelect.id = "settings-font-input";
  fontSelect.className = "settings-language-select";
  fontSelect.style.width = "100%";

  fontSection.append(fontLabel, fontSelect);

  const langSection = document.createElement("div");
  langSection.className = "settings-section";

  const langRow = document.createElement("div");
  langRow.className = "settings-language-row";

  const langLabel = document.createElement("label");
  langLabel.className = "settings-label";
  langLabel.textContent = t("language.label");

  const langSelect = document.createElement("select");
  langSelect.className = "settings-language-select";
  for (const lang of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang === "zh-CN" ? t("language.zhCN") : t("language.en");
    langSelect.append(opt);
  }
  langSelect.value = getLanguage();
  langSelect.addEventListener("change", () => {
    saveLanguage(langSelect.value as Lang);
  });
  langRow.append(langLabel, langSelect);
  langSection.append(langRow);

  const statusCard = document.createElement("div");
  statusCard.className = "settings-status-card";

  root.append(portSection, debugSection, fontSection, langSection, statusCard);

  let currentState: ListenerState | null = null;
  let isSubmitting = false;
  let fontOptionsPromise: Promise<string[]> | null = null;

  onLanguageChange(() => {
    portLabel.textContent = t("settings.listenPort");
    applyBtn.textContent = t("settings.apply");
    fontLabel.textContent = t("settings.fontFamily");
    debugText.textContent = t("settings.debug");
    langLabel.textContent = t("language.label");
    for (const opt of langSelect.options) {
      opt.textContent = opt.value === "zh-CN" ? t("language.zhCN") : t("language.en");
    }
    langSelect.value = getLanguage();
    void invoke("set_ui_language", { language: getLanguage() }).catch(() => {});
    if (currentState) {
      renderStatus(currentState);
    }
  });

  function renderFontOptions(fonts: string[], selectedFont: string): void {
    fontSelect.replaceChildren();
    for (const font of fonts) {
      const option = document.createElement("option");
      option.value = font;
      option.textContent = font;
      if (font === selectedFont) {
        option.selected = true;
      }
      fontSelect.append(option);
    }
  }

  function syncFontSelection(fontFamily: string): void {
    if (![...fontSelect.options].some((option) => option.value === fontFamily)) {
      const option = document.createElement("option");
      option.value = fontFamily;
      option.textContent = fontFamily;
      fontSelect.append(option);
    }
    fontSelect.value = fontFamily;
  }

  function loadFontOptions(): Promise<string[]> {
    fontOptionsPromise ??= invoke<string[]>("installed_fonts")
      .catch((error) => {
        fontOptionsPromise = null;
        throw error;
      });
    return fontOptionsPromise;
  }

  void loadFontOptions()
    .then((fonts) => renderFontOptions(fonts, currentState?.fontFamily ?? fontSelect.value))
    .catch(() => undefined);

  function renderStatus(state: ListenerState): void {
    currentState = state;
    if (!portInput.matches(":focus")) {
      portInput.value = String(state.port);
    }
    debugCheckbox.checked = Boolean(state.debugEnabled);
    applyFontFamily(state.fontFamily);
    syncFontSelection(state.fontFamily);

    statusCard.replaceChildren();

    const statusRow = document.createElement("div");
    statusRow.className = "settings-status-row";

    const dot = document.createElement("span");
    dot.className = "settings-status-dot";

    const text = document.createElement("span");

    if (state.error) {
      dot.dataset.status = "error";
      dot.textContent = "!";
      text.textContent = t("settings.listenerError");
    } else if (state.listening) {
      dot.dataset.status = "listening";
      dot.textContent = "●";
      text.textContent = t("settings.listeningOn", { address: state.address });
    } else {
      dot.dataset.status = "stopped";
      dot.textContent = "○";
      text.textContent = t("settings.stopped");
    }
    statusRow.append(dot, text);
    statusCard.append(statusRow);

    if (state.error) {
      const errorBox = document.createElement("div");
      errorBox.className = "settings-error-box";

      const errorTitle = document.createElement("div");
      errorTitle.className = "settings-error-title";
      errorTitle.textContent = t("settings.failureReason");

      const errorDetail = document.createElement("div");
      errorDetail.className = "settings-error-detail";
      errorDetail.textContent = state.error;

      errorBox.append(errorTitle, errorDetail);
      statusCard.append(errorBox);
    }

    const extSection = document.createElement("div");
    extSection.className = "settings-ext-section";

    const extTitle = document.createElement("div");
    extTitle.className = "settings-ext-title";
    const count = state.extensions?.length ?? 0;
    extTitle.textContent = t("settings.connectedExtensions", { count });
    extSection.append(extTitle);

    if (!state.extensions || state.extensions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-ext-empty";
      empty.textContent = t("settings.noExtensions");
      extSection.append(empty);
    } else {
      const extList = document.createElement("div");
      extList.className = "settings-ext-list";

      for (const ext of state.extensions) {
        const item = document.createElement("div");
        item.className = "settings-ext-item";

        const main = document.createElement("div");
        main.className = "settings-ext-item-main";

        const extDot = document.createElement("span");
        extDot.style.color = "#10b981";
        extDot.textContent = "●";

        const browserName = formatBrowserName(ext.browser);
        const labelText = ext.label && ext.label.length > 0 ? ext.label : ext.instanceUid;

        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${browserName} (${labelText})`;

        main.append(extDot, nameSpan);

        const meta = document.createElement("div");
        meta.className = "settings-ext-item-meta";
        meta.textContent =
          ext.windowsCount === 1
            ? t("settings.windowsOne", { count: ext.windowsCount })
            : t("settings.windowsOther", { count: ext.windowsCount });

        item.append(main, meta);
        extList.append(item);
      }
      extSection.append(extList);
    }

    statusCard.append(extSection);
  }

  function formatBrowserName(browser?: string): string {
    if (!browser) return t("ext.fallback");
    const b = browser.toLowerCase();
    if (b === "chrome") return "Chrome";
    if (b === "edge") return "Edge";
    if (b === "brave") return "Brave";
    if (b === "firefox") return "Firefox";
    if (b === "opera") return "Opera";
    if (b === "vivaldi") return "Vivaldi";
    return browser.charAt(0).toUpperCase() + browser.slice(1);
  }

  try {
    const initial = await invoke<ListenerState>("listener_state");
    renderStatus(initial);
  } catch (err) {
    statusCard.textContent = String(err);
  }

  const timer = setInterval(() => {
    if (isSubmitting) return;
    void invoke<ListenerState>("listener_state")
      .then(renderStatus)
      .catch(() => {});
  }, 1500);

  window.addEventListener("beforeunload", () => {
    clearInterval(timer);
  });

  portRow.addEventListener("submit", (event) => {
    event.preventDefault();
    void savePort();
  });

  async function savePort(): Promise<void> {
    const port = portInput.valueAsNumber;
    if (!port || port < 1 || port > 65535) return;
    isSubmitting = true;
    applyBtn.disabled = true;
    try {
      const next = await invoke<ListenerState>("set_listener_port", { port });
      renderStatus(next);
    } catch (error) {
      if (currentState) {
        renderStatus({
          ...currentState,
          error: String(error),
          listening: false,
        });
      }
    } finally {
      isSubmitting = false;
      applyBtn.disabled = false;
    }
  }

  fontSelect.addEventListener("focus", () => {
    void loadFontOptions()
      .then((fonts) => renderFontOptions(fonts, currentState?.fontFamily ?? fontSelect.value))
      .catch(() => undefined);
  });

  fontSelect.addEventListener("change", () => {
    const fontFamily = fontSelect.value;
    if (!fontFamily) return;
    isSubmitting = true;
    void invoke<ListenerState>("set_font_family", { fontFamily })
      .then(renderStatus)
      .catch((error) => {
        if (currentState) {
          renderStatus({
            ...currentState,
            error: String(error),
          });
        }
      })
      .finally(() => {
        isSubmitting = false;
      });
  });

  debugCheckbox.addEventListener("change", () => {
    const enabled = debugCheckbox.checked;
    void invoke<ListenerState>("set_debug_enabled", { enabled })
      .then(renderStatus)
      .catch((error) => {
        debugCheckbox.checked = !enabled;
        if (currentState) {
          renderStatus({
            ...currentState,
            error: String(error),
          });
        }
      });
  });

  await showWindowWhenReady();
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

interface ConnectedExtension {
  instanceUid: string;
  browser?: string;
  label?: string;
  windowsCount: number;
}

interface ListenerState {
  address: string;
  error?: string;
  listening: boolean;
  port: number;
  debugEnabled: boolean;
  fontFamily: string;
  extensions: ConnectedExtension[];
}

function requiredQuery(name: string): string {
  const value = query.get(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value;
}
