import type {
  LayoutEntry,
  MenuAnchor,
  MenuPlacement,
  MenuSnapshot,
} from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import "./styles.css";

const root = requiredElement("app");
const query = new URLSearchParams(location.search);

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
  const windowUid = requiredQuery("windowUid");
  const menuUid = requiredQuery("menuUid");
  const initial = await invoke<SurfaceState>("surface_state", {
    instanceUid,
    menuUid,
    surface: "menu",
    windowUid,
  });

  document.body.dataset.surface = "menu";

  let customizing = false;
  let currentMenu = initial.menu;

  // Track active popup state inside this single window
  let activePopupEl: HTMLElement | null = null;
  let activePopupFolderUid: string | null = null;

  await listen<MenuSnapshot>("menu-state", ({ payload }) => {
    if (payload.uid === menuUid && !customizing) {
      currentMenu = payload;
      renderSurface(payload);
    }
  });

  await listen<{ ok: boolean; message?: string }>("action-result", ({ payload }) => {
    root.toggleAttribute("data-error", !payload.ok);
    root.title = payload.ok ? "" : (payload.message ?? "Action failed");
  });

  if (initial.menu) {
    renderSurface(initial.menu);
  }

  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleClose(): void {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closePopup();
    }, 150);
  }

  function cancelClose(): void {
    clearTimeout(closeTimer);
  }

  let measureCanvas: HTMLCanvasElement | null = null;
  function measureTextWidth(text: string, fontSize: number): number {
    if (!measureCanvas) {
      measureCanvas = document.createElement("canvas");
    }
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) {
      return text.length * fontSize * 0.8;
    }
    ctx.font = `${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
    return ctx.measureText(text).width;
  }

  const MIN_COLUMN_WIDTH = 80;
  const MAX_COLUMN_WIDTH = 320;

  function calculateColumnWidth(entries: LayoutEntry[], fontSize: number): number {
    if (entries.length === 0) {
      return MIN_COLUMN_WIDTH;
    }
    let maxTextWidth = 0;
    let hasFolder = false;
    for (const entry of entries) {
      if (entry.kind === "folder") {
        hasFolder = true;
      }
      const w = measureTextWidth(entry.label, fontSize);
      if (w > maxTextWidth) {
        maxTextWidth = w;
      }
    }
    // padding: left 10px + right 12px, plus folder indicator 18px if needed
    const horizontalPadding = 10 + 12 + (hasFolder ? 18 : 6);
    const neededWidth = Math.ceil(maxTextWidth + horizontalPadding);
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, neededWidth));
  }

  function parseFontSize(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(8, Math.min(48, Math.round(value)));
    }
    if (value === "small") return 12;
    if (value === "large") return 15;
    return 13;
  }

  function calculateButtonFontSize(
    configuredSize: number,
    orientation: MenuOrientation,
    placement: MenuPlacement,
    itemCount: number,
  ): number {
    const count = Math.max(1, itemCount);
    const btnHeight = orientation === "row"
      ? placement.height
      : (placement.itemHeight ?? Math.max(16, Math.floor(placement.height / count)));
    const btnWidth = orientation === "column"
      ? placement.width
      : (placement.itemWidth ?? Math.max(20, Math.floor(placement.width / count)));

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
      menu.orientation,
      menu.placement,
      menu.items.length,
    );

    const gap = menu.placement.gap ?? menu.gap ?? 4;
    const menuBar = document.createElement("div");
    menuBar.className = "menu-bar";
    menuBar.ariaLabel = "BrowseRail menu";
    menuBar.dataset.orientation = menu.orientation;
    menuBar.style.setProperty("--item-count", String(Math.max(1, menu.items.length)));
    menuBar.style.setProperty("--button-font-size", `${buttonFontSize}px`);
    menuBar.style.setProperty("--menu-gap", `${gap}px`);
    menuBar.style.width = `${menu.placement.width}px`;
    menuBar.style.height = `${menu.placement.height}px`;

    menuBar.addEventListener("pointerenter", cancelClose);
    menuBar.addEventListener("pointerleave", (event) => {
      if (!activePopupEl || !activePopupEl.contains(event.relatedTarget as Node | null)) {
        scheduleClose();
      }
    });

    if (menu.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-menu";
      empty.textContent = "Empty menu · add items in extension";
      menuBar.replaceChildren(empty);
    } else {
      menuBar.replaceChildren(
        ...menu.items.map((entry) => renderMenuEntry(entry, menuBar)),
      );
    }

    menuBar.onpointerdown = (event) => {
      if (event.button === 2) {
        event.preventDefault();
        customizing = true;
        closePopup(false);
        const menuToCustomize = currentMenu ?? menu;
        const toolbar = renderCustomize(menuToCustomize);
        const toolbarSpace = customizationToolbarSpace(toolbar);
        const customizeWidth = toolbar.parentElement?.getBoundingClientRect().width
          ?? menuToCustomize.placement.width;
        void invoke<{ toolbarPosition: "top" | "bottom" }>("begin_menu_customization", {
          customizeWidth,
          instanceUid,
          menuUid,
          toolbarSpace,
          windowUid,
        })
          .then((info) => {
            if (info?.toolbarPosition === "top") {
              renderCustomize(menuToCustomize, "top");
            }
          })
          .catch((err) => {
            customizing = false;
            showSurfaceError(err);
          });
      }
    };
    menuBar.oncontextmenu = (event) => event.preventDefault();

    root.appendChild(menuBar);
  }

  function renderMenuEntry(entry: LayoutEntry, menuBar: HTMLElement): HTMLElement {
    const button = menuButton(entry, false);
    if (entry.kind === "bookmark") {
      button.addEventListener("pointerenter", () => {
        closePopup();
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.button === 0) {
          event.preventDefault();
          closePopup();
          void invokeAction(instanceUid, windowUid, entry.uid);
        }
      });
    } else {
      const expandOnHover = entry.expandOnHover !== false;
      if (expandOnHover) {
        button.addEventListener("pointerenter", () => {
          openPopup(entry, button, menuBar);
        });
        button.addEventListener("focus", () => {
          openPopup(entry, button, menuBar);
        });
      } else {
        button.addEventListener("pointerenter", () => {
          if (activePopupFolderUid !== entry.uid) {
            closePopup();
          }
        });
        button.addEventListener("pointerdown", (event) => {
          if (event.button === 0) {
            event.preventDefault();
            if (activePopupFolderUid === entry.uid && activePopupEl) {
              closePopup();
            } else {
              openPopup(entry, button, menuBar);
            }
          }
        });
      }
    }
    return button;
  }

  function openPopup(entry: LayoutEntry & { kind: "folder" }, anchorButton: HTMLElement, menuBar: HTMLElement): void {
    if (activePopupFolderUid === entry.uid && activePopupEl) {
      return;
    }

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

    const popupEl = document.createElement("div");
    popupEl.className = "popup-container";
    popupEl.ariaLabel = "BrowseRail bookmark menu";
    popupEl.addEventListener("pointerenter", cancelClose);
    popupEl.addEventListener("pointerleave", (event) => {
      if (!menuBar.contains(event.relatedTarget as Node | null)) {
        scheduleClose();
      }
    });
    activePopupEl = popupEl;

    // Position popup right next to the anchor button
    const anchorRect = anchorButton.getBoundingClientRect();
    const menuRect = menuBar.getBoundingClientRect();

    if (currentMenu?.orientation === "column") {
      popupEl.style.top = `${anchorRect.top}px`;
      popupEl.style.left = `${anchorRect.right + 2}px`;
    } else {
      popupEl.style.top = `${anchorRect.bottom + 2}px`;
      popupEl.style.left = `${anchorRect.left}px`;
    }

    root.appendChild(popupEl);

    const theme = applyMenuTheme(currentMenu ?? initial.menu!);
    renderLevels();

    function renderLevels(): void {
      const columnWidths = levels.map((entries) => calculateColumnWidth(entries, theme.fontSize));

      popupEl.replaceChildren(
        ...levels.map((entries, level) => {
          const column = document.createElement("div");
          column.className = "menu-column";
          const colWidth = columnWidths[level];
          column.style.width = `${colWidth}px`;
          column.style.minWidth = `${colWidth}px`;
          column.style.maxWidth = `${colWidth}px`;
          column.append(
            ...entries.map((item) => {
              const button = menuButton(item, true);
              if (item.kind === "folder") {
                const subExpand = item.expandOnHover !== false;
                button.toggleAttribute("data-expanded", expandedUids[level] === item.uid);
                if (subExpand) {
                  button.addEventListener("pointerenter", () => {
                    levels = [...levels.slice(0, level + 1), item.children];
                    expandedUids = [...expandedUids.slice(0, level), item.uid];
                    renderLevels();
                  });
                } else {
                  button.addEventListener("pointerenter", () => {
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
                  if (levels.length > level + 1) {
                    levels = levels.slice(0, level + 1);
                    expandedUids = expandedUids.slice(0, level);
                    renderLevels();
                  }
                });
                button.addEventListener("pointerdown", (event) => {
                  if (event.button === 0) {
                    closePopup();
                    void invokeAction(instanceUid, windowUid, item.uid);
                  }
                });
              }
              return button;
            }),
          );
          return column;
        }),
      );

      const totalColumnsWidth = columnWidths.reduce((acc, w) => acc + w, 0);
      const gapTotal = Math.max(0, levels.length - 1) * 4;
      // .popup-container has 7px padding (14px total) and 1px border (2px total), plus 2px safety buffer
      const popupWidth = Math.min(1600, 18 + totalColumnsWidth + gapTotal);

      const popupHeightVal = Math.min(
        560,
        Math.max(...levels.map((entries) => popupColumnHeight(entries, theme.itemHeight))),
      );
      popupEl.style.width = `${popupWidth}px`;
      popupEl.style.height = `${popupHeightVal}px`;

      const totalWidth = currentMenu?.orientation === "column"
        ? Math.max(menuRect.width, anchorRect.right + 2 + popupWidth)
        : Math.max(menuRect.width, anchorRect.left + popupWidth);
      const totalHeight = currentMenu?.orientation === "column"
        ? Math.max(menuRect.height, anchorRect.top + popupHeightVal)
        : Math.max(menuRect.height, anchorRect.bottom + 2 + popupHeightVal);

      void invoke("resize_popup", {
        height: totalHeight,
        instanceUid,
        menuUid,
        width: totalWidth,
        windowUid,
      });
    }
  }

  function closePopup(restoreNativeSize = true): void {
    clearTimeout(closeTimer);
    if (activePopupEl) {
      activePopupEl.remove();
      activePopupEl = null;
    }
    activePopupFolderUid = null;
    for (const btn of root.querySelectorAll(".menu-button[data-expanded]")) {
      btn.removeAttribute("data-expanded");
    }

    if (restoreNativeSize && currentMenu && !customizing) {
      void invoke("resize_popup", {
        height: currentMenu.placement.height,
        instanceUid,
        menuUid,
        width: currentMenu.placement.width,
        windowUid,
      });
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
    let targetWidth = menu.placement.width;
    let targetHeight = menu.placement.height;
    root.className = "customize-mode";
    root.dataset.toolbarPosition = toolbarPosition;
    root.dataset.orientation = menu.orientation;
    root.onpointerdown = null;

    const gap = menu.placement.gap ?? menu.gap ?? 4;
    const railContainer = document.createElement("div");
    railContainer.className = "customize-rail";
    railContainer.dataset.orientation = menu.orientation;
    railContainer.style.setProperty("--item-count", String(Math.max(1, menu.items.length)));
    railContainer.style.setProperty("--menu-gap", `${gap}px`);

    function updateCustomizeButtonSize(): void {
      const btnFontSize = calculateButtonFontSize(
        theme.fontSize,
        menu.orientation,
        { ...menu.placement, width: targetWidth, height: targetHeight },
        menu.items.length,
      );
      railContainer.style.setProperty("--button-font-size", `${btnFontSize}px`);
    }
    updateCustomizeButtonSize();

    if (menu.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-menu";
      empty.textContent = "Empty menu · add items in extension";
      railContainer.replaceChildren(empty);
    } else {
      railContainer.replaceChildren(
        ...menu.items.map((entry) => menuButton(entry, false)),
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
    anchorButton.title = `Anchor: ${anchorLabel(anchor)} (click to change)`;
    anchorButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        anchor = nextAnchor(anchor);
        anchorButton.replaceChildren(createAnchorIcon(anchor));
        anchorButton.title = `Anchor: ${anchorLabel(anchor)} (click to change)`;
      }
    });

    const moveButton = controlButton(createMoveIcon());
    moveButton.title = "Drag to move";
    moveButton.classList.add("move-handle");
    moveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
        void invoke("start_menu_drag");
      }
    });

    const cancelButton = controlButton(createCancelIcon());
    cancelButton.title = "Cancel";
    cancelButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void cancelCustomization();
      }
    });

    const saveButton = controlButton(createSaveIcon());
    saveButton.title = "Save placement";
    saveButton.addEventListener("pointerdown", (event) => {
      if (event.button === 0) {
        void saveCustomization();
      }
    });

    toolbar.append(anchorButton, moveButton, cancelButton, saveButton);

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

    function growNativeCanvasIfNeeded(): void {
      const requiredWidth = Math.ceil(content.getBoundingClientRect().width);
      const requiredHeight = Math.ceil(
        targetHeight + customizationToolbarSpace(toolbar),
      );
      const width = Math.max(window.innerWidth, requiredWidth);
      const height = Math.max(window.innerHeight, requiredHeight);
      if (width > window.innerWidth || height > window.innerHeight) {
        void invoke("resize_popup", {
          height,
          instanceUid,
          menuUid,
          width,
          windowUid,
        });
      }
    }

    function resizeHandle(direction: "east" | "south" | "southEast"): HTMLElement {
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
          if (direction === "east" || direction === "southEast") {
            targetWidth = clampWidth(startWidth + moveEvent.screenX - startX);
          }
          if (direction === "south" || direction === "southEast") {
            targetHeight = clampHeight(startHeight + moveEvent.screenY - startY);
          }
          applyTargetSize();
          growNativeCanvasIfNeeded();
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
      customizing = false;
      await invoke("cancel_menu_customization", { instanceUid, menuUid, windowUid });
      if (currentMenu) {
        renderSurface(currentMenu);
      }
    }

    async function saveCustomization(): Promise<void> {
      const toolbarSpace = customizationToolbarSpace(toolbar);
      const placement = await invoke<MenuPlacement>("save_menu_placement", {
        anchor,
        height: targetHeight,
        instanceUid,
        menuUid,
        toolbarPosition,
        toolbarSpace,
        width: targetWidth,
        windowUid,
      });
      customizing = false;
      if (currentMenu) {
        currentMenu = { ...currentMenu, placement };
        renderSurface(currentMenu);
      }
    }

    return toolbar;
  }
}

function menuButton(entry: LayoutEntry, popup: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.toggleAttribute("data-popup", popup);
  button.title = entry.label;

  if (entry.color) {
    button.style.setProperty("--button-custom-color", entry.color);
    button.dataset.hasCustomColor = "true";
  }

  const labelSpan = document.createElement("span");
  labelSpan.className = "menu-button-label";
  labelSpan.textContent = entry.label;
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

async function invokeAction(
  instanceUid: string,
  windowUid: string,
  actionUid: string,
): Promise<void> {
  try {
    await invoke("invoke_action", { actionUid, instanceUid, windowUid });
  } catch (error) {
    root.dataset.error = "";
    root.title = String(error);
  }
}

function showSurfaceError(error: unknown): void {
  root.dataset.error = "";
  root.title = String(error);
}

function popupColumnHeight(entries: LayoutEntry[], itemHeight = 36): number {
  return Math.min(560, Math.max(48, 16 + entries.length * (itemHeight + 2)));
}

async function initializeListenerSettings(): Promise<void> {
  document.body.dataset.view = "settings";
  root.className = "listener-settings";

  const portSection = document.createElement("div");
  portSection.className = "settings-section";

  const portLabel = document.createElement("label");
  portLabel.className = "settings-label";
  portLabel.htmlFor = "settings-port-input";
  portLabel.textContent = "Listen Port";

  const portRow = document.createElement("form");
  portRow.className = "settings-port-row";

  const portInput = document.createElement("input");
  portInput.id = "settings-port-input";
  portInput.type = "number";
  portInput.min = "1";
  portInput.max = "65535";
  portInput.required = true;

  const applyBtn = document.createElement("button");
  applyBtn.type = "submit";
  applyBtn.textContent = "Apply";

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
  debugText.textContent = "Debug";

  debugLabel.append(debugCheckbox, debugText);
  debugSection.append(debugLabel);

  const statusCard = document.createElement("div");
  statusCard.className = "settings-status-card";

  root.append(portSection, debugSection, statusCard);

  let currentState: ListenerState | null = null;
  let isSubmitting = false;

  function renderStatus(state: ListenerState): void {
    currentState = state;
    if (!portInput.matches(":focus")) {
      portInput.value = String(state.port);
    }
    debugCheckbox.checked = Boolean(state.debugEnabled);

    statusCard.replaceChildren();

    const statusRow = document.createElement("div");
    statusRow.className = "settings-status-row";

    const dot = document.createElement("span");
    dot.className = "settings-status-dot";

    const text = document.createElement("span");

    if (state.error) {
      dot.dataset.status = "error";
      dot.textContent = "!";
      text.textContent = "Listener Error";
    } else if (state.listening) {
      dot.dataset.status = "listening";
      dot.textContent = "●";
      text.textContent = `Listening on ${state.address}`;
    } else {
      dot.dataset.status = "stopped";
      dot.textContent = "○";
      text.textContent = "Stopped";
    }
    statusRow.append(dot, text);
    statusCard.append(statusRow);

    if (state.error) {
      const errorBox = document.createElement("div");
      errorBox.className = "settings-error-box";

      const errorTitle = document.createElement("div");
      errorTitle.className = "settings-error-title";
      errorTitle.textContent = "Failure Reason";

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
    extTitle.textContent = `Connected Extensions (${count})`;
    extSection.append(extTitle);

    if (!state.extensions || state.extensions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "settings-ext-empty";
      empty.textContent = "No extensions connected";
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
        meta.textContent = `${ext.windowsCount} window${ext.windowsCount === 1 ? "" : "s"}`;

        item.append(main, meta);
        extList.append(item);
      }
      extSection.append(extList);
    }

    statusCard.append(extSection);
  }

  function formatBrowserName(browser?: string): string {
    if (!browser) return "Extension";
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
