import {
  invertBookmarkActionUid,
  type ExpandDirection,
  type LayoutEntry,
} from "@browserail/protocol";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PopupPayload {
  color?: string;
  direction: ExpandDirection;
  editingLocked: boolean;
  entries: LayoutEntry[];
  isFree: boolean;
  itemHeight: number;
  maxColumnHeight: number;
  popupFontSize: number;
  requestUid: string;
}

interface PopupSurfaceState {
  fontFamily: string;
  payload?: PopupPayload;
}

const HOVER_OPEN_DELAY_MS = 60;
const MIN_COLUMN_HEIGHT = 48;

export async function initializePopupSurface(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const instanceUid = requiredQuery(query, "instanceUid");
  const menuUid = requiredQuery(query, "menuUid");
  const windowUid = requiredQuery(query, "windowUid", true);
  const surfaceLabel = getCurrentWindow().label;
  const root = requiredElement("app");
  const initial = await invoke<PopupSurfaceState>("surface_state", {
    instanceUid,
    menuUid,
    surface: "popup",
    windowUid,
  }).catch(() => undefined);

  document.body.dataset.surface = "popup";
  if (initial) {
    document.documentElement.style.setProperty("--desktop-font-family", initial.fontFamily);
  }

  let currentPayload: PopupPayload | undefined;
  let editingLocked = false;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;

  const cancelNativeClose = (): void => {
    void invoke("cancel_popup_close", { instanceUid, menuUid, windowUid }).catch(() => {});
  };
  const scheduleNativeClose = (): void => {
    void invoke("schedule_popup_close", { instanceUid, menuUid, windowUid }).catch(() => {});
  };

  await listen<PopupPayload>("popup-state", ({ payload }) => {
    render(payload);
  }, { target: surfaceLabel });
  await listen<boolean>("editing-lock-changed", ({ payload }) => {
    editingLocked = payload;
  });
  await listen<string>("font-family-changed", ({ payload }) => {
    document.documentElement.style.setProperty("--desktop-font-family", payload);
  });

  if (initial?.payload) render(initial.payload);

  function render(payload: PopupPayload): void {
    currentPayload = payload;
    editingLocked = payload.editingLocked;
    clearTimeout(hoverTimer);
    root.className = "popup-surface";
    root.style.setProperty("--menu-font-size", `${payload.popupFontSize}px`);
    root.style.setProperty("--menu-item-height", `${payload.itemHeight}px`);

    const popup = document.createElement("div");
    popup.className = "popup-container detached-popup";
    popup.dataset.direction = payload.direction;
    popup.ariaLabel = "BrowseRail bookmark menu";
    popup.style.flexDirection = payload.direction === "left" ? "row-reverse" : "row";
    popup.style.alignItems = payload.direction === "up" ? "flex-end" : "flex-start";
    popup.addEventListener("pointerenter", cancelNativeClose);
    popup.addEventListener("pointerleave", scheduleNativeClose);

    let levels: LayoutEntry[][] = [payload.entries];
    let expandedUids: string[] = [];
    const columns: HTMLElement[] = [];
    const renderedLevels: LayoutEntry[][] = [];

    const dispatchAction = (actionUid: string): void => {
      void invoke("close_popup", { instanceUid, menuUid, windowUid });
      if (actionUid.startsWith("noop")) return;
      const action = payload.isFree
        ? invoke("invoke_free_action", { actionUid, instanceUid, menuUid })
        : invoke("invoke_action", { actionUid, instanceUid, windowUid });
      void action.catch(() => {});
    };

    const scheduleHover = (target: HTMLElement, open: () => void): void => {
      const schedule = (): void => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          hoverTimer = undefined;
          if (target.isConnected && currentPayload?.requestUid === payload.requestUid) open();
        }, HOVER_OPEN_DELAY_MS);
      };
      target.addEventListener("pointerenter", schedule);
      target.addEventListener("pointermove", () => {
        if (hoverTimer) schedule();
      });
      target.addEventListener("pointerleave", () => clearTimeout(hoverTimer));
      target.addEventListener("pointercancel", () => clearTimeout(hoverTimer));
      target.addEventListener("pointerdown", () => clearTimeout(hoverTimer), { capture: true });
    };

    const buildColumn = (entries: LayoutEntry[], level: number): HTMLElement => {
      const column = document.createElement("div");
      column.className = "menu-column";
      column.style.maxHeight = `${payload.maxColumnHeight}px`;
      column.style.width = `${calculateColumnWidth(
        entries,
        payload.popupFontSize,
        payload.maxColumnHeight,
        payload.itemHeight,
      )}px`;
      if (payload.color) {
        column.dataset.accent = "true";
        column.style.backgroundColor = payload.color;
        column.style.borderColor = payload.color;
      }

      for (const entry of entries) {
        if (entry.kind === "space" || entry.kind === "menuToggle") continue;
        const button = menuButton(entry);
        if (payload.color) {
          button.style.setProperty("--button-custom-color", payload.color);
          button.dataset.hasCustomColor = "true";
        }
        if (entry.kind === "folder") {
          button.dataset.uid = entry.uid;
          button.toggleAttribute("data-expanded", expandedUids[level] === entry.uid);
          const openChild = (): void => {
            cancelNativeClose();
            if (expandedUids[level] === entry.uid && levels.length > level + 1) return;
            levels = [...levels.slice(0, level + 1), entry.children];
            expandedUids = [...expandedUids.slice(0, level), entry.uid];
            renderLevels();
          };
          if (entry.expandOnHover !== false) {
            scheduleHover(button, openChild);
          } else {
            button.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              if (expandedUids[level] === entry.uid) {
                levels = levels.slice(0, level + 1);
                expandedUids = expandedUids.slice(0, level);
                renderLevels();
              } else {
                openChild();
              }
            });
          }
        } else {
          button.addEventListener("pointerenter", () => {
            cancelNativeClose();
            if (levels.length <= level + 1) return;
            levels = levels.slice(0, level + 1);
            expandedUids = expandedUids.slice(0, level);
            renderLevels();
          });
          button.addEventListener("pointerdown", (event) => {
            if (event.button === 0) {
              event.preventDefault();
              dispatchAction(entry.uid);
            } else if (event.button === 2 && editingLocked) {
              event.preventDefault();
              event.stopPropagation();
              dispatchAction(invertBookmarkActionUid(entry.uid));
            }
          });
        }
        column.appendChild(button);
      }
      return column;
    };

    const renderLevels = (): void => {
      let diffFrom = 0;
      while (
        diffFrom < renderedLevels.length &&
        diffFrom < levels.length &&
        renderedLevels[diffFrom] === levels[diffFrom]
      ) {
        diffFrom++;
      }
      for (let index = columns.length - 1; index >= diffFrom; index--) {
        columns[index]?.remove();
      }
      columns.length = diffFrom;
      renderedLevels.length = diffFrom;

      for (let level = diffFrom; level < levels.length; level++) {
        const column = buildColumn(levels[level]!, level);
        if (level > 0 && payload.direction !== "up") {
          const parent = columns[level - 1]?.querySelector<HTMLElement>(
            `.menu-button[data-uid="${CSS.escape(expandedUids[level - 1] ?? "")}"]`,
          );
          if (parent) {
            const offset = parent.getBoundingClientRect().top - popup.getBoundingClientRect().top;
            const marginTop = Math.min(
              Math.max(0, offset),
              Math.max(0, payload.maxColumnHeight - MIN_COLUMN_HEIGHT),
            );
            column.style.marginTop = `${marginTop}px`;
            column.style.maxHeight = `${Math.max(MIN_COLUMN_HEIGHT, payload.maxColumnHeight - marginTop)}px`;
          }
        }
        popup.appendChild(column);
        columns[level] = column;
        renderedLevels[level] = levels[level]!;
      }

      for (let level = 0; level < diffFrom; level++) {
        const expandedUid = expandedUids[level];
        for (const button of columns[level]!.querySelectorAll<HTMLElement>(".menu-button[data-uid]")) {
          button.toggleAttribute("data-expanded", button.dataset.uid === expandedUid);
        }
      }
    };

    root.replaceChildren(popup);
    renderLevels();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentPayload?.requestUid !== payload.requestUid) return;
        void invoke("show_popup", {
          instanceUid,
          menuUid,
          requestUid: payload.requestUid,
          windowUid,
        });
      });
    });
  }
}

function menuButton(
  entry: Exclude<LayoutEntry, { kind: "space" } | { kind: "menuToggle" }>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.dataset.popup = "";
  button.title = entry.label;
  const label = document.createElement("span");
  label.className = "menu-button-label";
  label.textContent = entry.rename
    ? entry.rename === entry.label || entry.label.startsWith(entry.rename)
      ? entry.label
      : `${entry.rename} (${entry.label})`
    : entry.label;
  button.append(label);
  if (entry.kind === "folder") {
    button.dataset.folder = "";
    button.setAttribute("aria-haspopup", "menu");
  }
  return button;
}

let measureCanvas: HTMLCanvasElement | undefined;
function calculateColumnWidth(
  entries: LayoutEntry[],
  fontSize: number,
  maxColumnHeight: number,
  itemHeight: number,
): number {
  const canvas = measureCanvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) {
    const fontFamily = getComputedStyle(document.documentElement)
      .getPropertyValue("--desktop-font-family")
      .trim();
    context.font = `${fontSize}px ${fontFamily}`;
  }
  const padding = 2 * Math.min(10, Math.max(4, fontSize * 0.75));
  const folderBlock = Math.min(8, Math.max(6, fontSize * 0.5));
  let width = 0;
  for (const entry of entries) {
    if (entry.kind === "space" || entry.kind === "menuToggle") continue;
    const text = entry.rename && entry.rename !== entry.label && !entry.label.startsWith(entry.rename)
      ? `${entry.rename} (${entry.label})`
      : entry.label;
    width = Math.max(
      width,
      (context?.measureText(text).width ?? text.length * fontSize) +
        padding +
        (entry.kind === "folder" ? folderBlock : 0),
    );
  }
  const contentHeight = 14 + entries.length * (itemHeight + 2);
  const scrollbarBuffer = contentHeight > maxColumnHeight ? 18 : 0;
  return Math.min(420, Math.max(72, Math.ceil(width + 20) + scrollbarBuffer));
}

function requiredQuery(query: URLSearchParams, name: string, allowEmpty = false): string {
  const value = query.get(name);
  if (value === null || (!allowEmpty && !value)) throw new Error(`Missing ${name}`);
  return value;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}
