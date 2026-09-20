import {
  invertBookmarkActionUid,
  type ExpandDirection,
  type LayoutEntry,
  type MenuAnchor,
  type MenuPlacement,
  type MenuSnapshot,
} from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { getLanguage, type Lang, LANGUAGES, onLanguageChange, saveLanguage, t } from "@browserail/i18n";
import "./styles.css";

const root = requiredElement("app");
const query = new URLSearchParams(location.search);
const FREE_DRAG_HANDLE_SIZE = 10;
const DEFAULT_FONT_FAMILY = "Inter, ui-sans-serif, system-ui, sans-serif";

let currentFontFamily = DEFAULT_FONT_FAMILY;

function applyFontFamily(fontFamily: string): void {
  currentFontFamily = fontFamily;
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
} else {
  void initializeSurface();
}

async function initializeSurface(): Promise<void> {
  const instanceUid = requiredQuery("instanceUid");
  const menuUid = requiredQuery("menuUid");
  // A free (detached) surface has no bound browser window: it fetches its own
  // snapshot by instance+menu and dispatches actions without a windowUid.
  const isFree = query.get("free") === "1";
  const windowUid = isFree ? "" : requiredQuery("windowUid");
  const surfaceLabel = getCurrentWindow().label;
  const initial = isFree
    ? await invoke<SurfaceState>("free_surface_state", { instanceUid, menuUid })
    : await invoke<SurfaceState>("surface_state", {
        instanceUid,
        menuUid,
        surface: "menu",
        windowUid,
      });

  applyFontFamily(initial.fontFamily);
  document.body.dataset.surface = "menu";
  if (isFree) {
    document.body.dataset.free = "1";
  }

  // Dispatch a bookmark action. A free surface sends no windowUid (the extension
  // targets its current lastFocused window); a bound surface sends its window.
  const dispatchAction = (actionUid: string): void => {
    void (async () => {
      try {
        if (isFree) {
          await invoke("invoke_free_action", { actionUid, instanceUid, menuUid });
        } else {
          await invoke("invoke_action", { actionUid, instanceUid, windowUid });
        }
      } catch (error) {
        root.dataset.error = "";
        root.title = String(error);
      }
    })();
  };

  if (isFree) {
    // Report the free surface's settled absolute (logical) position after the
    // user drags it, so the extension can persist it in free_placements.
    const appWindow = getCurrentWindow();
    let moveReportTimer: ReturnType<typeof setTimeout> | undefined;
    void appWindow.onMoved(({ payload }) => {
      // Only user drags (via the handle) persist a new position. While
      // customizing, begin/save/cancel move the window programmatically — those
      // moves must NOT overwrite free_position, or the toolbar-shifted spot gets
      // saved and the bar drifts a notch every time.
      if (customizing) return;
      clearTimeout(moveReportTimer);
      moveReportTimer = setTimeout(() => {
        void (async () => {
          try {
            const scale = await appWindow.scaleFactor();
            await invoke("update_free_placement", {
              instanceUid,
              menuUid,
              x: payload.x / scale,
              y: payload.y / scale,
            });
          } catch {
            // Ignore: position will be reported again on the next move.
          }
        })();
      }, 250);
    });
  }

  let customizing = false;
  // Global "lock editing" tray toggle: when on, right-click must not open customize.
  let editingLocked = false;
  let currentMenu = initial.menu;
  let menuCollapsed = initial.collapsed;

  const POPUP_CLOSE_DELAY_MS = 50;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let deferredCloseDelay: number | undefined;
  let popupGeometryPending = false;
  let popupGeometryRevision = 0;
  let pendingMenuRender = false;

  window.addEventListener(
    "pointerout",
    (event) => {
      // Pointer left the window entirely (no relatedTarget) → close the popup.
      if (!event.relatedTarget) {
        scheduleClose(POPUP_CLOSE_DELAY_MS);
      }
    },
    { passive: true },
  );

  // Track active popup state inside this single window
  let activePopupEl: HTMLElement | null = null;
  let activePopupFolderUid: string | null = null;

  let nativeAllocated = {
    height: 0,
    width: 0,
  };
  let nativeContentOffset = { x: 0, y: 0 };
  let popupGeometryQueue = Promise.resolve();

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

  let customizationStartPosition: SurfacePoint | null = null;

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

  await listen<MenuStateEvent>("menu-state", ({ payload }) => {
    if (
      payload.instanceUid === instanceUid &&
      payload.windowUid === (isFree ? null : windowUid) &&
      payload.menu?.uid === menuUid &&
      !customizing
    ) {
      currentMenu = payload.menu;
      menuCollapsed = payload.collapsed ?? menuCollapsed;
      if (activePopupEl || popupGeometryPending) {
        pendingMenuRender = true;
        return;
      }
      renderSurface(payload.menu);
    }
  }, { target: surfaceLabel });

  void invoke<boolean>("is_editing_locked")
    .then((locked) => {
      editingLocked = locked;
    })
    .catch(() => {});
  await listen<boolean>("editing-lock-changed", ({ payload }) => {
    editingLocked = payload;
  });
  await listen<string>("font-family-changed", ({ payload }) => {
    applyFontFamily(payload);
  });

  if (initial.menu) {
    renderSurface(initial.menu);
  }

  function scheduleClose(delay = POPUP_CLOSE_DELAY_MS): void {
    // While customizing there is no popup, and the window is deliberately
    // enlarged to fit the customize toolbar. The window-level pointerout that
    // fires when the cursor leaves the window must not schedule a popup close:
    // closePopup restores the native window to the (small) bar placement size,
    // which would shrink the customize window mid-edit.
    if (customizing) return;
    // Trust pointerenter(cancelClose)/pointerleave(scheduleClose): re-entering a
    // column or the expanded folder button cancels this timer. The old
    // elementFromPoint(lastPointer) re-check kept the popup open over the
    // transparent gap between columns, because the pointer stops firing pointermove
    // there (pointer-events:none), leaving the cached position stale inside a column.
    clearTimeout(closeTimer);
    if (popupGeometryPending) {
      deferredCloseDelay = delay;
      return;
    }
    closeTimer = setTimeout(() => {
      void closePopup();
    }, delay);
  }

  function cancelClose(): void {
    clearTimeout(closeTimer);
    deferredCloseDelay = undefined;
  }

  // Any element that belongs to the open popup surface: the flyout itself or
  // the menu bar/anchor button.
  function isPopupInteractionTarget(el: Element | null): boolean {
    if (!el) return false;
    if (!el.closest) return false;
    return Boolean(el.closest(".popup-container, .menu-bar"));
  }

  let measureCanvas: HTMLCanvasElement | null = null;
  function measureTextWidth(text: string, fontSize: number): number {
    if (!measureCanvas) {
      measureCanvas = document.createElement("canvas");
    }
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) {
      return text.length * fontSize * 1.0;
    }
    ctx.font = `${fontSize}px ${currentFontFamily}`;
    return ctx.measureText(text).width;
  }

  const MIN_COLUMN_WIDTH = 72;
  const MAX_COLUMN_WIDTH = 420;
  const MIN_COLUMN_HEIGHT = 48;
  const POPUP_SCREEN_MARGIN = 4;

  function calculateColumnWidth(
    entries: LayoutEntry[],
    fontSize: number,
    maxColumnHeight: number,
    buttonPadding?: number,
  ): number {
    if (entries.length === 0) {
      return MIN_COLUMN_WIDTH;
    }
    // Keep the width driven by the widest measured label plus the real box
    // padding it sits in, so short labels do not inherit the slack of long ones.
    // Popup button padding is clamp(4px, fontSize * 0.75, 10px) per side and the
    // folder color block overlays the right edge, so only folders reserve it.
    const paddingPerSide = buttonPadding ?? Math.min(10, Math.max(4, fontSize * 0.75));
    const totalButtonPadding = 2 * paddingPerSide;
    const folderBlock = Math.min(8, Math.max(6, fontSize * 0.5));
    let maxContentWidth = 0;
    for (const entry of entries) {
      if (entry.kind === "space") continue;
      if (entry.kind === "menuToggle") continue;
      const displayText =
        entry.rename && entry.rename !== entry.label && !entry.label.startsWith(entry.rename)
          ? `${entry.rename} (${entry.label})`
          : entry.label;
      const w =
        measureTextWidth(displayText, fontSize) +
        totalButtonPadding +
        (entry.kind === "folder" ? folderBlock : 0);
      if (w > maxContentWidth) maxContentWidth = w;
    }
    // Column padding (12px) + border (2px) = 14px, plus a 6px safety buffer for
    // subpixel font rendering and DirectWrite kerning.
    const neededWidth = Math.ceil(maxContentWidth + 14 + 6);
    // Reserve room for the vertical scrollbar only when the entries will actually
    // overflow the column height; otherwise it is pure empty space.
    const itemHeight = Math.max(24, Math.round(fontSize * 2.7));
    const contentHeight = 12 + 2 + entries.length * (itemHeight + 2);
    const scrollbarBuffer = contentHeight > maxColumnHeight ? 18 : 0;
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, neededWidth + scrollbarBuffer));
  }

  async function getSurfaceAvailableHeight(above: boolean): Promise<number> {
    const height = await invoke<number>("surface_available_height", { above });
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error("Surface available height is unavailable");
    }
    return height;
  }

  function parseFontSize(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(8, Math.min(48, Math.round(value)));
    }
    if (value === "small") return 12;
    if (value === "large") return 15;
    return 13;
  }

  function computeMenuDimensions(menu: MenuSnapshot): { width: number; height: number } {
    const totalUnits = menu.items.reduce((acc, item) => {
      if (item.kind === "space") {
        return acc + Math.max(0.1, item.units ?? 1);
      }
      return acc + 1;
    }, 0);
    const count = Math.max(1, Math.round(totalUnits));
    const itemWidth = menu.placement.itemWidth ?? 84;
    const itemHeight = menu.placement.itemHeight ?? 36;
    const gap = menu.placement.gap ?? menu.gap ?? 4;
    if (menu.orientation === "row") {
      return {
        width: count * itemWidth + (count - 1) * gap,
        height: itemHeight,
      };
    }
    return {
      width: itemWidth,
      height: count * itemHeight + (count - 1) * gap,
    };
  }

  function computeSurfaceDimensions(menu: MenuSnapshot): { width: number; height: number } {
    const dimensions = computeMenuDimensions(menu);
    if (menuCollapsed) {
      return {
        width: menu.placement.itemWidth ?? 84,
        height: menu.placement.itemHeight ?? 36,
      };
    }
    if (!isFree) {
      return dimensions;
    }
    // The drag handle lives in the flex flow next to the bar (see
    // .free-drag-handle in CSS), so the surface is the menu plus that strip.
    return menu.orientation === "row"
      ? { width: dimensions.width + FREE_DRAG_HANDLE_SIZE, height: dimensions.height }
      : { width: dimensions.width, height: dimensions.height + FREE_DRAG_HANDLE_SIZE };
  }

  function calculateButtonFontSize(
    configuredSize: number,
    placement: { itemWidth?: number; itemHeight?: number },
  ): number {
    const btnHeight = placement.itemHeight ?? 36;
    const btnWidth = placement.itemWidth ?? 84;
    const heightLimit = Math.max(8, Math.floor(btnHeight - 8));
    const widthLimit = Math.max(8, Math.floor(btnWidth * 0.45));
    return Math.min(configuredSize, heightLimit, widthLimit);
  }

  function applyMenuTheme(menu: MenuSnapshot): { fontSize: number; itemHeight: number } {
    const sizeNum = parseFontSize(menu.fontSize ?? menu.placement.fontSize);
    const itemHeight = Math.max(24, Math.round(sizeNum * 2.7));
    root.style.setProperty("--menu-font-size", `${sizeNum}px`);
    root.style.setProperty("--menu-item-height", `${itemHeight}px`);
    return { fontSize: sizeNum, itemHeight };
  }

  function renderSurface(menu: MenuSnapshot): void {
    const theme = applyMenuTheme(menu);
    root.className = "menu-surface";
    root.replaceChildren();

    const buttonFontSize = calculateButtonFontSize(
      theme.fontSize,
      menu.placement,
    );

    const gap = menu.placement.gap ?? menu.gap ?? 4;
    const menuBar = document.createElement("div");
    menuBar.className = "menu-bar";
    menuBar.ariaLabel = t("aria.menu");
    menuBar.dataset.orientation = menu.orientation;
    // Row menus default to down and column menus default to right, while an
    // explicit direction may place the popup on any side of the anchor button.
    const totalUnits = menu.items.reduce((acc, item) => {
      if (item.kind === "space") {
        return acc + Math.max(0.1, item.units ?? 1);
      }
      return acc + 1;
    }, 0);
    menuBar.style.setProperty(
      "--item-count",
      String(menuCollapsed ? 1 : Math.max(1, Math.round(totalUnits))),
    );
    menuBar.style.setProperty("--button-font-size", `${buttonFontSize}px`);
    menuBar.style.setProperty("--menu-gap", `${gap}px`);
    if (menu.buttonPadding !== undefined) {
      menuBar.style.setProperty("--menu-button-padding", `${menu.buttonPadding}px`);
    }
    const dims = computeMenuDimensions(menu);
    const renderedDims = menuCollapsed
      ? {
          width: menu.placement.itemWidth ?? 84,
          height: menu.placement.itemHeight ?? 36,
        }
      : dims;
    menuBar.style.width = `${renderedDims.width}px`;
    menuBar.style.height = `${renderedDims.height}px`;

    menuBar.addEventListener("pointerenter", cancelClose);
    menuBar.addEventListener("pointerleave", (event) => {
      const related = event.relatedTarget as Element | null;
      if (!isPopupInteractionTarget(related)) {
        scheduleClose(POPUP_CLOSE_DELAY_MS);
      }
    });

    if (menuCollapsed) {
      const toggle = menu.items.find((entry) => entry.kind === "menuToggle");
      if (toggle && toggle.kind === "menuToggle") {
        const toggleEl = renderMenuEntry(toggle, menuBar);
        menuBar.replaceChildren(toggleEl);
      } else {
        const empty = document.createElement("div");
        empty.className = "empty-menu";
        empty.textContent = t("menu.empty");
        menuBar.replaceChildren(empty);
      }
    } else if (menu.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-menu";
      empty.textContent = t("menu.empty");
      menuBar.replaceChildren(empty);
    } else {
      menuBar.replaceChildren(
        ...menu.items.map((entry) => renderMenuEntry(entry, menuBar)),
      );
    }

    menuBar.onpointerdown = async (event) => {
      if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        if (menuCollapsed) return;
        if (editingLocked) return;
        if (customizing) return;

        // If a popup is open, close it and wait for size and position to restore completely before customizing
        await closePopup(true);

        const fromAnchor = elementOrigin(menuBar);
        const menuHeight = menuBar.getBoundingClientRect().height;
        customizationStartPosition = await windowOrigin();
        customizing = true;
        const menuToCustomize = currentMenu ?? menu;
        const toolbar = renderCustomize(menuToCustomize);
        const toolbarSpace = customizationToolbarSpace(toolbar);
        void invoke<{ toolbarPosition: "top" | "bottom" }>("begin_menu_customization", {
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
          .catch((err) => {
            customizing = false;
            customizationStartPosition = null;
            renderSurface(menuToCustomize);
            showSurfaceError(err);
          });
      }
    };
    menuBar.oncontextmenu = (event) => event.preventDefault();

    if (isFree && !(menuCollapsed && menu.items.some((entry) => entry.kind === "menuToggle"))) {
      // Dedicated drag handle: the only way to move a free surface (buttons stay
      // clickable). Position updates preserve the no-activate window contract;
      // onMoved persists the settled spot.
      root.dataset.orientation = menu.orientation;
      const handle = document.createElement("div");
      handle.className = "free-drag-handle";
      handle.title = t("free.dragHandle");
      if (menu.orientation === "row") {
        handle.style.width = `${FREE_DRAG_HANDLE_SIZE}px`;
        handle.style.height = `${dims.height}px`;
      } else {
        handle.style.width = `${dims.width}px`;
        handle.style.height = `${FREE_DRAG_HANDLE_SIZE}px`;
      }
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        handle.setPointerCapture(event.pointerId);

        const startScreenX = event.screenX;
        const startScreenY = event.screenY;
        const appWindow = getCurrentWindow();
        let origin: { x: number; y: number } | undefined;
        let pendingFrame: number | undefined;

        void Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()]).then(
          ([position, scale]) => {
            origin = { x: position.x / scale, y: position.y / scale };
          },
        );

        const move = (moveEvent: PointerEvent): void => {
          if (!origin) return;
          const x = origin.x + moveEvent.screenX - startScreenX;
          const y = origin.y + moveEvent.screenY - startScreenY;
          if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
          pendingFrame = requestAnimationFrame(() => {
            pendingFrame = undefined;
            void invoke("move_free_surface", { x, y });
          });
        };
        const stop = (stopEvent: PointerEvent): void => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
          if (handle.hasPointerCapture(stopEvent.pointerId)) {
            handle.releasePointerCapture(stopEvent.pointerId);
          }
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
      });
      handle.oncontextmenu = (event) => event.preventDefault();
      root.appendChild(handle);
    }
    root.appendChild(menuBar);
  }

  function renderMenuEntry(entry: LayoutEntry, menuBar: HTMLElement): HTMLElement {
    if (entry.kind === "space") {
      const spaceEl = document.createElement("div");
      spaceEl.className = "menu-space";
      const units = Math.max(0.1, entry.units ?? 1);
      spaceEl.style.setProperty("--space-units", String(units));
      const isTransparent = entry.transparent !== false;
      spaceEl.dataset.transparent = isTransparent ? "true" : "false";
      if (isTransparent) {
        spaceEl.style.backgroundColor = "transparent";
      } else if (entry.color) {
        spaceEl.style.backgroundColor = entry.color;
      } else {
        spaceEl.classList.add("menu-space-solid");
      }
      spaceEl.addEventListener("pointerenter", () => {
        if (activePopupEl) {
          scheduleClose(POPUP_CLOSE_DELAY_MS);
        }
      });
      return spaceEl;
    }

    if (entry.kind === "menuToggle") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-button menu-toggle-button";
      const labelSpan = document.createElement("span");
      labelSpan.className = "menu-button-label";
      labelSpan.textContent = entry.label;
      button.append(labelSpan);
      button.title = menuCollapsed ? t("menu.expand") : t("menu.collapse");
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const beforeAnchor = elementOrigin(button);
        void invoke<boolean>("toggle_menu_collapsed", { instanceUid, menuUid })
          .then(async (collapsed) => {
            menuCollapsed = collapsed;
            const menuSnapshot = currentMenu ?? initial.menu;
            if (!menuSnapshot) return;
            renderSurface(menuSnapshot);
            const toggle = root.querySelector<HTMLElement>(
              ".menu-bar .menu-toggle-button",
            );
            if (!toggle) return;
            await requestDoubleAnimationFrame();
            const { width, height } = computeSurfaceDimensions(menuSnapshot);
            await resizeAndPosition(
              beforeAnchor,
              elementOrigin(toggle),
              width,
              height,
            );
          })
          .catch(() => undefined);
      });
      return button;
    }

    const button = menuButton(entry, false);
    if (entry.kind === "bookmark") {
      button.addEventListener("pointerenter", () => {
        if (activePopupEl) {
          scheduleClose(POPUP_CLOSE_DELAY_MS);
        }
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.button === 0) {
          event.preventDefault();
          void closePopup();
          if (!entry.uid.startsWith("noop")) {
            dispatchAction(entry.uid);
          }
        }
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.button === 2 && editingLocked) {
          event.preventDefault();
          event.stopPropagation();
          void closePopup();
          if (!entry.uid.startsWith("noop")) {
            dispatchAction(invertBookmarkActionUid(entry.uid));
          }
        }
      });
    } else {
      const expandOnHover = entry.expandOnHover !== false;
      const hasChildren = Boolean(entry.children && entry.children.length > 0);
      if (expandOnHover) {
        button.addEventListener("pointerenter", () => {
          cancelClose();
          if (hasChildren) {
            openPopup(entry, button, menuBar);
          }
        });
        button.addEventListener("focus", () => {
          cancelClose();
          if (hasChildren) {
            openPopup(entry, button, menuBar);
          }
        });
      } else {
        button.addEventListener("pointerenter", () => {
          if (activePopupFolderUid !== entry.uid && activePopupEl) {
            scheduleClose(POPUP_CLOSE_DELAY_MS);
          }
        });
        button.addEventListener("pointerdown", (event) => {
          if (event.button === 0) {
            event.preventDefault();
            if (activePopupFolderUid === entry.uid && activePopupEl) {
              void closePopup();
            } else if (hasChildren) {
              openPopup(entry, button, menuBar);
            }
          }
        });
      }
    }
    return button;
  }

  async function openPopup(entry: LayoutEntry & { kind: "folder" }, anchorButton: HTMLElement, menuBar: HTMLElement): Promise<void> {
    if (activePopupFolderUid === entry.uid && activePopupEl) {
      return;
    }

    cancelClose();

    // Mark anchor button as expanded
    for (const btn of menuBar.querySelectorAll(".menu-button")) {
      btn.removeAttribute("data-expanded");
    }
    anchorButton.toggleAttribute("data-expanded", true);

    if (activePopupEl) {
      activePopupEl.remove();
      activePopupEl = null;
    }

    activePopupFolderUid = entry.uid;

    let levels: LayoutEntry[][] = [entry.children];
    let expandedUids: string[] = [];
    const columnEls: HTMLElement[] = [];
    const renderedLevels: LayoutEntry[][] = [];

    const menuColor = currentMenu?.color;
    const popupEl = document.createElement("div");
    popupEl.className = "popup-container";
    popupEl.ariaLabel = t("aria.bookmarkMenu");
    activePopupEl = popupEl;
    // The container is hit-testable (pointer-events:auto) so it also owns the
    // inter-column gaps and whatever menu-bar button sits underneath it.
    // Listening here keeps "pointer left the flyout" honest across the anchor
    // seam instead of only at column boundaries.
    popupEl.addEventListener("pointerenter", cancelClose);
    popupEl.addEventListener("pointerleave", (event) => {
      const related = event.relatedTarget as Element | null;
      if (!isPopupInteractionTarget(related)) {
        scheduleClose(POPUP_CLOSE_DELAY_MS);
      }
    });

    const configuredDirection =
      (entry.expandDirection === "right" ||
      entry.expandDirection === "left" ||
      entry.expandDirection === "down" ||
      entry.expandDirection === "up"
        ? entry.expandDirection
        : undefined) ??
      (currentMenu?.expandDirection === "right" ||
      currentMenu?.expandDirection === "left" ||
      currentMenu?.expandDirection === "down" ||
      currentMenu?.expandDirection === "up"
        ? currentMenu.expandDirection
        : undefined);
    const direction: ExpandDirection =
      configuredDirection ?? (currentMenu?.orientation === "column" ? "right" : "down");
    popupEl.dataset.direction = direction;

    // Use un-transformed layout offsets relative to menuBar, NOT viewport getBoundingClientRect!
    // getBoundingClientRect is contaminated when menuBar has a previous translateY/X transform.
    const btnLeft = anchorButton.offsetLeft;
    const btnTop = anchorButton.offsetTop;
    const btnWidth = anchorButton.offsetWidth;
    const btnHeight = anchorButton.offsetHeight;
    const dims = currentMenu ? computeSurfaceDimensions(currentMenu) : undefined;
    const surfaceWidth = dims?.width ?? menuBar.offsetWidth;
    const surfaceHeight = dims?.height ?? menuBar.offsetHeight;
    const menuBarLeft = menuBar.offsetLeft;
    const menuBarTop = menuBar.offsetTop;

    const theme = applyMenuTheme(currentMenu ?? initial.menu!);
    let availableHeight: number;
    try {
      availableHeight = await getSurfaceAvailableHeight(direction === "up");
    } catch (error) {
      showSurfaceError(error);
      activePopupEl = null;
      activePopupFolderUid = null;
      popupEl.remove();
      return;
    }
    if (activePopupEl !== popupEl) {
      return;
    }

    const popupGap = 2;
    const anchorTop = menuBarTop + nativeContentOffset.y + btnTop;
    const popupTop =
      direction === "down"
        ? anchorTop + btnHeight + popupGap
        : anchorTop;
    const maxColumnHeight = Math.max(
      MIN_COLUMN_HEIGHT,
      direction === "up"
        ? availableHeight + anchorTop - popupGap - POPUP_SCREEN_MARGIN
        : availableHeight - popupTop - POPUP_SCREEN_MARGIN,
    );

    root.appendChild(popupEl);
    renderLevels();

    function setContentOffset(x: number, y: number): void {
      const transform = x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px)`;
      menuBar.style.transform = transform;
      const freeHandle = root.querySelector<HTMLElement>(".free-drag-handle");
      if (freeHandle) {
        freeHandle.style.transform = transform;
      }
    }

    async function applyNativePopupGeometry(
      targetWidth: number,
      targetHeight: number,
      targetOffsetX: number,
      targetOffsetY: number,
    ): Promise<void> {
      const neededWidth = Math.max(nativeAllocated.width, targetWidth);
      const neededHeight = Math.max(nativeAllocated.height, targetHeight);
      const neededOffsetX = Math.max(nativeContentOffset.x, targetOffsetX);
      const neededOffsetY = Math.max(nativeContentOffset.y, targetOffsetY);
      if (
        neededWidth === nativeAllocated.width &&
        neededHeight === nativeAllocated.height &&
        neededOffsetX === nativeContentOffset.x &&
        neededOffsetY === nativeContentOffset.y
      ) return;

      const fromAnchor = elementOrigin(menuBar);
      nativeAllocated = { height: neededHeight, width: neededWidth };
      nativeContentOffset = { x: neededOffsetX, y: neededOffsetY };
      setContentOffset(neededOffsetX, neededOffsetY);
      const toAnchor = elementOrigin(menuBar);
      await resizeAndPosition(fromAnchor, toAnchor, neededWidth, neededHeight);
    }

    function buildColumn(entries: LayoutEntry[], level: number, colWidth: number): HTMLElement {
      const column = document.createElement("div");
      column.className = "menu-column";
      column.style.maxHeight = `${maxColumnHeight}px`;
      column.addEventListener("pointerenter", cancelClose);
      column.addEventListener("pointerleave", (event) => {
        const related = event.relatedTarget as Element | null;
        if (!isPopupInteractionTarget(related) && !menuBar.contains(related as Node | null)) {
          scheduleClose(POPUP_CLOSE_DELAY_MS);
        }
      });
      column.style.width = `${colWidth}px`;
      column.style.minWidth = `${colWidth}px`;
      column.style.maxWidth = `${colWidth}px`;
      if (menuColor) {
        column.dataset.accent = "true";
        column.style.backgroundColor = menuColor;
        column.style.borderColor = menuColor;
      }
      for (const item of entries) {
        if (item.kind === "space" || item.kind === "menuToggle") continue;
        const button = menuButton(item, true);
        if (menuColor) {
          button.style.setProperty("--button-custom-color", menuColor);
          button.dataset.hasCustomColor = "true";
        }
        if (item.kind === "folder") {
          button.dataset.uid = item.uid;
          const subExpand = item.expandOnHover !== false;
          button.toggleAttribute("data-expanded", expandedUids[level] === item.uid);
          if (subExpand) {
            button.addEventListener("pointerenter", () => {
              cancelClose();
              // Already the open child → no-op, so scrolling this column (which slides
              // this folder back under the cursor) does not rebuild and reset scroll.
              if (expandedUids[level] === item.uid && levels.length > level + 1) return;
              levels = [...levels.slice(0, level + 1), item.children];
              expandedUids = [...expandedUids.slice(0, level), item.uid];
              renderLevels();
            });
          } else {
            button.addEventListener("pointerenter", () => {
              cancelClose();
              if (levels.length > level + 1 && expandedUids[level] !== item.uid) {
                levels = levels.slice(0, level + 1);
                expandedUids = expandedUids.slice(0, level);
                renderLevels();
              }
            });
            button.addEventListener("pointerdown", (event) => {
              if (event.button === 0) {
                event.preventDefault();
                if (expandedUids[level] === item.uid) {
                  levels = levels.slice(0, level + 1);
                  expandedUids = expandedUids.slice(0, level);
                } else {
                  levels = [...levels.slice(0, level + 1), item.children];
                  expandedUids = [...expandedUids.slice(0, level), item.uid];
                }
                renderLevels();
              }
            });
          }
        } else {
          button.addEventListener("pointerenter", () => {
            cancelClose();
            if (levels.length > level + 1) {
              levels = levels.slice(0, level + 1);
              expandedUids = expandedUids.slice(0, level);
              renderLevels();
            }
          });
          button.addEventListener("pointerdown", (event) => {
            if (event.button === 0) {
              void closePopup();
              if (!item.uid.startsWith("noop")) {
                dispatchAction(item.uid);
              }
            }
          });
          button.addEventListener("pointerdown", (event) => {
            if (event.button === 2 && editingLocked) {
              event.preventDefault();
              event.stopPropagation();
              void closePopup();
              if (!item.uid.startsWith("noop")) {
                dispatchAction(invertBookmarkActionUid(item.uid));
              }
            }
          });
        }
        column.appendChild(button);
      }
      return column;
    }

    function positionPopup(
      contentOffsetX: number,
      contentOffsetY: number,
      popupWidth: number,
      popupHeight: number,
    ): { width: number; height: number } {
      const gap = popupGap;
      let totalWidth = contentOffsetX + surfaceWidth;
      let totalHeight = contentOffsetY + surfaceHeight;

      if (direction === "right") {
        const top = contentOffsetY + menuBarTop + btnTop;
        const left = contentOffsetX + menuBarLeft + btnLeft + btnWidth + gap;
        popupEl.style.top = `${top}px`;
        popupEl.style.left = `${left}px`;
        totalWidth = Math.max(totalWidth, left + popupWidth);
        totalHeight = Math.max(totalHeight, top + popupHeight);
      } else if (direction === "left") {
        const top = contentOffsetY + menuBarTop + btnTop;
        const left = contentOffsetX + menuBarLeft + btnLeft - gap - popupWidth;
        popupEl.style.top = `${top}px`;
        popupEl.style.left = `${left}px`;
        totalWidth = Math.max(totalWidth, left + popupWidth);
        totalHeight = Math.max(totalHeight, top + popupHeight);
      } else if (direction === "up") {
        const top = contentOffsetY + menuBarTop + btnTop - gap - popupHeight;
        const left = contentOffsetX + menuBarLeft + btnLeft;
        popupEl.style.top = `${top}px`;
        popupEl.style.left = `${left}px`;
        totalWidth = Math.max(totalWidth, left + popupWidth);
        totalHeight = Math.max(totalHeight, top + popupHeight);
      } else {
        const top = contentOffsetY + menuBarTop + btnTop + btnHeight + gap;
        const left = contentOffsetX + menuBarLeft + btnLeft;
        popupEl.style.top = `${top}px`;
        popupEl.style.left = `${left}px`;
        totalWidth = Math.max(totalWidth, left + popupWidth);
        totalHeight = Math.max(totalHeight, top + popupHeight);
      }

      return { width: totalWidth, height: totalHeight };
    }

    function renderLevels(): void {
      const columnWidths = levels.map((entries) =>
        calculateColumnWidth(
          entries,
          theme.fontSize,
          maxColumnHeight,
          currentMenu?.buttonPadding,
        ),
      );

      popupEl.style.flexDirection = direction === "left" ? "row-reverse" : "row";
      popupEl.style.alignItems = direction === "up" ? "flex-end" : "flex-start";
      popupEl.style.bottom = "";
      popupEl.style.right = "";

      // Incremental: keep columns whose level is unchanged (same entries ref) so
      // their DOM — and scroll position — survive; rebuild only from the first change.
      let diffFrom = 0;
      while (
        diffFrom < renderedLevels.length &&
        diffFrom < levels.length &&
        renderedLevels[diffFrom] === levels[diffFrom]
      ) {
        diffFrom++;
      }
      for (let i = columnEls.length - 1; i >= diffFrom; i--) {
        columnEls[i]?.remove();
      }
      columnEls.length = diffFrom;
      renderedLevels.length = diffFrom;

      for (let level = diffFrom; level < levels.length; level++) {
        const column = buildColumn(levels[level]!, level, columnWidths[level]!);
        // A sub-column opens aligned with the parent item that was hovered (its
        // current on-screen position, honoring the parent column's scroll), not the top.
        if (level > 0 && direction !== "up") {
          const parentBtn = columnEls[level - 1]?.querySelector<HTMLElement>(
            `.menu-button[data-uid="${expandedUids[level - 1]}"]`,
          );
          if (parentBtn) {
            const offset =
              parentBtn.getBoundingClientRect().top - popupEl.getBoundingClientRect().top;
            const marginTop = Math.min(
              Math.max(0, offset),
              Math.max(0, maxColumnHeight - MIN_COLUMN_HEIGHT),
            );
            column.style.marginTop = `${marginTop}px`;
            column.style.maxHeight = `${Math.max(MIN_COLUMN_HEIGHT, maxColumnHeight - marginTop)}px`;
          }
        }
        popupEl.appendChild(column);
        columnEls[level] = column;
        renderedLevels[level] = levels[level]!;
      }

      // Refresh the expanded highlight on the kept parent columns.
      for (let level = 0; level < diffFrom; level++) {
        const uid = expandedUids[level];
        for (const btn of columnEls[level]!.querySelectorAll<HTMLElement>(".menu-button[data-uid]")) {
          btn.toggleAttribute("data-expanded", btn.dataset.uid === uid);
        }
      }

      // Width is set explicitly (analytical) — an abspos width:auto flex container
      // can measure 0 and leave the popup clipped outside the window. Height is
      // measured (offsetHeight is reliable regardless of container width) so it
      // accounts for the sub-column top margins.
      const gapTotal = Math.max(0, levels.length - 1) * 4;
      const popupWidth = columnWidths.reduce((acc, w) => acc + w, 0) + gapTotal;
      popupEl.style.width = `${popupWidth}px`;
      positionPopup(
        nativeContentOffset.x,
        nativeContentOffset.y,
        popupWidth,
        popupEl.offsetHeight,
      );
      schedulePopupGeometry();
    }

    function schedulePopupGeometry(): void {
      const revision = ++popupGeometryRevision;
      popupGeometryPending = true;
      void (async () => {
        await requestDoubleAnimationFrame();
        await popupGeometryQueue.catch(() => undefined);
        if (revision !== popupGeometryRevision || activePopupEl !== popupEl) return;

        const resize = commitPopupGeometry();
        popupGeometryQueue = resize;
        await resize;
      })()
        .catch(() => undefined)
        .finally(() => {
          if (revision !== popupGeometryRevision) return;
          popupGeometryPending = false;
          const delay = deferredCloseDelay;
          deferredCloseDelay = undefined;
          if (delay !== undefined) scheduleClose(delay);
        });
    }

    async function commitPopupGeometry(): Promise<void> {
      const popupWidth = popupEl.offsetWidth;
      const popupHeight = popupEl.offsetHeight;
      const gap = popupGap;
      const requiredOffsetX = direction === "left"
        ? Math.max(0, popupWidth + gap - (menuBarLeft + btnLeft))
        : 0;
      const requiredOffsetY = direction === "up"
        ? Math.max(0, popupHeight + gap - (menuBarTop + btnTop))
        : 0;
      const contentOffsetX = Math.max(nativeContentOffset.x, requiredOffsetX);
      const contentOffsetY = Math.max(nativeContentOffset.y, requiredOffsetY);
      const totals = positionPopup(
        contentOffsetX,
        contentOffsetY,
        popupWidth,
        popupHeight,
      );

      await applyNativePopupGeometry(
        totals.width,
        totals.height,
        contentOffsetX,
        contentOffsetY,
      );
    }
  }

  async function closePopup(restoreNativeSize = true): Promise<void> {
    clearTimeout(closeTimer);
    deferredCloseDelay = undefined;
    popupGeometryRevision++;
    popupGeometryPending = false;
    if (activePopupEl) {
      activePopupEl.remove();
      activePopupEl = null;
    }
    activePopupFolderUid = null;
    const menuBarEl = root.querySelector<HTMLElement>(".menu-bar");
    for (const btn of root.querySelectorAll(".menu-button[data-expanded]")) {
      btn.removeAttribute("data-expanded");
    }

    if (restoreNativeSize && currentMenu && !customizing) {
      await popupGeometryQueue.catch(() => undefined);
      const { width, height } = computeSurfaceDimensions(currentMenu);
      const fromAnchor = menuBarEl ? elementOrigin(menuBarEl) : { x: 0, y: 0 };
      if (menuBarEl) menuBarEl.style.transform = "";
      const freeHandle = root.querySelector<HTMLElement>(".free-drag-handle");
      if (freeHandle) freeHandle.style.transform = "";
      nativeContentOffset = { x: 0, y: 0 };
      nativeAllocated = {
        height,
        width,
      };
      try {
        const toAnchor = menuBarEl ? elementOrigin(menuBarEl) : { x: 0, y: 0 };
        popupGeometryQueue = resizeAndPosition(fromAnchor, toAnchor, width, height);
        await popupGeometryQueue;
      } catch {}
    }

    if (pendingMenuRender && currentMenu) {
      pendingMenuRender = false;
      renderSurface(currentMenu);
    }
  }

  function customizationToolbarSpace(toolbar: HTMLElement): number {
    const container = toolbar.parentElement ?? root;
    const rowGap = Number.parseFloat(getComputedStyle(container).rowGap);
    const gap = Number.isFinite(rowGap) ? rowGap : 0;
    return Math.ceil(toolbar.getBoundingClientRect().height + gap);
  }

  function renderCustomize(
    menu: MenuSnapshot,
    toolbarPosition: "top" | "bottom" = "bottom",
  ): HTMLElement {
    const theme = applyMenuTheme(menu);
    let anchor = menu.placement.anchor;
    const initialDims = computeMenuDimensions(menu);
    let targetWidth = initialDims.width;
    let targetHeight = initialDims.height;
    root.className = "customize-mode";
    root.dataset.toolbarPosition = toolbarPosition;
    root.dataset.orientation = menu.orientation;
    root.onpointerdown = null;

    const gap = menu.placement.gap ?? menu.gap ?? 4;
    const railContainer = document.createElement("div");
    railContainer.className = "customize-rail";
    railContainer.dataset.orientation = menu.orientation;
    const totalUnits = menu.items.reduce((acc, it) => {
      if (it.kind === "space") {
        return acc + Math.max(1, Math.round(it.units ?? 1));
      }
      return acc + 1;
    }, 0);
    railContainer.style.setProperty("--item-count", String(Math.max(1, Math.round(totalUnits))));
    railContainer.style.setProperty("--menu-gap", `${gap}px`);
    if (menu.buttonPadding !== undefined) {
      railContainer.style.setProperty("--menu-button-padding", `${menu.buttonPadding}px`);
    }

    function updateCustomizeButtonSize(): void {
      const count = Math.max(1, Math.round(totalUnits));
      const itemWidth = menu.orientation === "column"
        ? targetWidth
        : Math.max(20, (targetWidth - (count - 1) * gap) / count);
      const itemHeight = menu.orientation === "row"
        ? targetHeight
        : Math.max(16, (targetHeight - (count - 1) * gap) / count);
      const btnFontSize = calculateButtonFontSize(
        theme.fontSize,
        { itemWidth, itemHeight },
      );
      railContainer.style.setProperty("--button-font-size", `${btnFontSize}px`);
    }
    updateCustomizeButtonSize();

    if (menu.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-menu";
      empty.textContent = t("menu.empty");
      railContainer.replaceChildren(empty);
    } else {
      railContainer.replaceChildren(
        ...menu.items.map((entry) => {
          if (entry.kind === "space") {
            const spaceEl = document.createElement("div");
            spaceEl.className = "menu-space";
            const units = Math.max(0.1, entry.units ?? 1);
            spaceEl.style.setProperty("--space-units", String(units));
            const isTransparent = entry.transparent !== false;
            spaceEl.dataset.transparent = isTransparent ? "true" : "false";
            if (isTransparent) {
              spaceEl.style.backgroundColor = "transparent";
            } else if (entry.color) {
              spaceEl.style.backgroundColor = entry.color;
            } else {
              spaceEl.classList.add("menu-space-solid");
            }
            return spaceEl;
          }
          if (entry.kind === "menuToggle") {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "menu-button";
            const labelSpan = document.createElement("span");
            labelSpan.className = "menu-button-label";
            labelSpan.textContent = entry.label;
            button.append(labelSpan);
            return button;
          }
          return menuButton(entry, false);
        }),
      );
    }

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

    const anchorButton = controlButton(createAnchorIcon(anchor));
    anchorButton.title = t("customize.anchor", { anchor: anchorLabel(anchor) });
    anchorButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        anchor = nextAnchor(anchor);
        anchorButton.replaceChildren(createAnchorIcon(anchor));
        anchorButton.title = t("customize.anchor", { anchor: anchorLabel(anchor) });
      }
    });

    const moveButton = controlButton(createMoveIcon());
    moveButton.title = t("customize.dragToMove");
    moveButton.classList.add("move-handle");
    moveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
        void invoke("start_menu_drag");
      }
    });

    const cancelButton = controlButton(createCancelIcon());
    cancelButton.title = t("customize.cancel");
    cancelButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void cancelCustomization();
      }
    });

    const saveButton = controlButton(createSaveIcon());
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
      updateCustomizeButtonSize();
    }

    let resizeFrame: number | undefined;
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

    function resizeHandle(direction: "east" | "south" | "southEast" | "north"): HTMLElement {
      const handle = document.createElement("div");
      handle.className = `resize-handle resize-${direction}`;
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
          const fromResizeAnchor = direction === "north"
            ? (() => {
                const rect = railContainer.getBoundingClientRect();
                return { x: rect.left, y: rect.bottom };
              })()
            : elementOrigin(railContainer);
          if (direction === "east" || direction === "southEast") {
            targetWidth = clampWidth(startWidth + moveEvent.screenX - startX);
          }
          if (direction === "south" || direction === "southEast") {
            targetHeight = clampHeight(startHeight + moveEvent.screenY - startY);
          }
          if (direction === "north") {
            targetHeight = clampHeight(startHeight - (moveEvent.screenY - startY));
          }
          applyTargetSize();
          const toResizeAnchor = direction === "north"
            ? (() => {
                const rect = railContainer.getBoundingClientRect();
                return { x: rect.left, y: rect.bottom };
              })()
            : elementOrigin(railContainer);
          resizeNativeCanvas(fromResizeAnchor, toResizeAnchor);
        };
        const stop = (stopEvent: PointerEvent): void => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
          if (handle.hasPointerCapture(stopEvent.pointerId)) {
            handle.releasePointerCapture(stopEvent.pointerId);
          }
        };

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
      resizeHandle("southEast"),
    );

    if (toolbarPosition === "top") {
      content.replaceChildren(toolbar, railContainer);
    } else {
      content.replaceChildren(railContainer, toolbar);
    }
    root.replaceChildren(content);
    applyTargetSize();

    async function cancelCustomization(): Promise<void> {
      const restorePosition = customizationStartPosition;
      customizing = false;
      await invoke("cancel_menu_customization", { instanceUid, menuUid, windowUid });
      if (currentMenu) {
        renderSurface(currentMenu);
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
        renderSurface(currentMenu);
        const menuBar = root.querySelector<HTMLElement>(".menu-bar");
        if (menuBar) {
          const { width, height } = computeSurfaceDimensions(currentMenu);
          await resizeAndPosition(fromAnchor, elementOrigin(menuBar), width, height);
        }
      }
    }

    return toolbar;
  }
}

  function menuButton(
    entry: Exclude<LayoutEntry, { kind: "space" } | { kind: "menuToggle" }>,
    popup: boolean,
  ): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.toggleAttribute("data-popup", popup);
  button.title = entry.label;

  // Popup (expanded folder) buttons are colored by the menu's default color at the
  // popup level, not by the item's own color — so skip per-item color here for them.
  if (!popup && entry.color) {
    button.style.setProperty("--button-custom-color", entry.color);
    button.dataset.hasCustomColor = "true";
  }

  const labelSpan = document.createElement("span");
  labelSpan.className = "menu-button-label";
  const displayText = entry.rename;
  if (displayText) {
    if (popup) {
      labelSpan.textContent =
        displayText === entry.label || entry.label.startsWith(displayText)
          ? entry.label
          : `${displayText} (${entry.label})`;
    } else {
      labelSpan.textContent = displayText;
    }
  } else {
    labelSpan.textContent = entry.label;
  }
  if (!popup && /^\p{Extended_Pictographic}+$/u.test(labelSpan.textContent.trim())) {
    labelSpan.classList.add("menu-button-emoji");
    button.dataset.hasEmoji = "true";
  }
  button.append(labelSpan);

  if (entry.kind === "folder") {
    button.dataset.folder = "";
    button.setAttribute("aria-haspopup", "menu");
  }
  return button;
}

function controlButton(content: string | Element): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "customize-control";
  if (typeof content === "string") {
    button.textContent = content;
  } else {
    button.append(content);
  }
  return button;
}

function createAnchorIcon(anchor: MenuAnchor): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "1.5");
  rect.setAttribute("y", "1.5");
  rect.setAttribute("width", "13");
  rect.setAttribute("height", "13");
  rect.setAttribute("rx", "2.5");
  rect.setAttribute("stroke", "currentColor");
  rect.setAttribute("stroke-width", "1.3");
  rect.setAttribute("stroke-opacity", "0.6");

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  let cx = "4.5";
  let cy = "4.5";
  switch (anchor) {
    case "topLeft":
      cx = "4.5";
      cy = "4.5";
      break;
    case "topRight":
      cx = "11.5";
      cy = "4.5";
      break;
    case "bottomRight":
      cx = "11.5";
      cy = "11.5";
      break;
    case "bottomLeft":
      cx = "4.5";
      cy = "11.5";
      break;
  }
  dot.setAttribute("cx", cx);
  dot.setAttribute("cy", cy);
  dot.setAttribute("r", "2.2");
  dot.setAttribute("fill", "#7aa2ff");

  svg.append(rect, dot);
  return svg;
}

function createMoveIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  );
  svg.append(path);
  return svg;
}

function createSaveIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#34d399");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "20 6 9 17 4 12");
  svg.append(polyline);
  return svg;
}

function createCancelIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#f87171");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "18");
  line1.setAttribute("y1", "6");
  line1.setAttribute("x2", "6");
  line1.setAttribute("y2", "18");

  const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "6");
  line2.setAttribute("y1", "6");
  line2.setAttribute("x2", "18");
  line2.setAttribute("y2", "18");

  svg.append(line1, line2);
  return svg;
}

function nextAnchor(anchor: MenuAnchor): MenuAnchor {
  const anchors: MenuAnchor[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  return anchors[(anchors.indexOf(anchor) + 1) % anchors.length]!;
}

function anchorLabel(anchor: MenuAnchor): string {
  return { topLeft: "TL", topRight: "TR", bottomLeft: "BL", bottomRight: "BR" }[anchor];
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
}

interface SurfaceState {
  kind: "menu";
  menu?: MenuSnapshot;
  collapsed?: boolean;
  fontFamily: string;
}

interface MenuStateEvent {
  instanceUid: string;
  windowUid?: string | null;
  menu?: MenuSnapshot;
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
