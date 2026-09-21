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
  rootDirection: ExpandDirection;
  rootOffsetX: number;
  workLeft: number;
  workRight: number;
}

interface PopupSurfaceState {
  fontFamily: string;
  payload?: PopupPayload;
}

interface PointerSample {
  time: number;
  x: number;
  y: number;
}

const HOVER_OPEN_DELAY_MS = 60;
const SUBMENU_SWITCH_DELAY_MS = 180;
const SUBMENU_AIM_DELAY_MS = 320;
const POINTER_TRAIL_MAX_AGE_MS = 180;
const MIN_COLUMN_HEIGHT = 48;
const BASE_MAX_COLUMN_WIDTH = 420;
const BASE_POPUP_FONT_SIZE = 13;

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
  let hoverTarget: HTMLElement | undefined;

  const setContentVisible = (visible: boolean): void => {
    root.toggleAttribute("data-popup-content-hidden", !visible);
  };
  const setPopupPointerInside = (inside: boolean): void => {
    void invoke("set_popup_pointer_inside", {
      inside,
      instanceUid,
      menuUid,
      source: "popup",
      windowUid,
    }).catch(() => {});
  };

  await listen<PopupPayload>("popup-state", ({ payload }) => {
    render(payload);
  }, { target: surfaceLabel });
  await listen<boolean>("popup-content-visibility", ({ payload }) => {
    setContentVisible(payload);
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
    setContentVisible(true);
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
    hoverTarget = undefined;
    root.className = "popup-surface";
    root.style.setProperty("--menu-font-size", `${payload.popupFontSize}px`);
    root.style.setProperty("--menu-item-height", `${payload.itemHeight}px`);

    const popup = document.createElement("div");
    popup.className = "popup-container detached-popup";
    popup.dataset.direction = payload.rootDirection;
    popup.ariaLabel = "BrowseRail bookmark menu";
    const horizontal = payload.direction === "left" || payload.direction === "right";
    if (horizontal) {
      popup.dataset.horizontal = "true";
      popup.style.display = "block";
      popup.style.height = "100%";
    } else {
      popup.style.flexDirection = "row";
      popup.style.alignItems = payload.direction === "up" ? "flex-end" : "flex-start";
    }
    let levels: LayoutEntry[][] = [payload.entries];
    let expandedUids: string[] = [];
    let expandedDirections: ExpandDirection[] = [];
    const columns: HTMLElement[] = [];
    const renderedLevels: LayoutEntry[][] = [];
    const pointerTrail: PointerSample[] = [];
    let hitRegionRevision = 0;

    popup.addEventListener("pointermove", (event) => {
      const sample = { time: event.timeStamp, x: event.clientX, y: event.clientY };
      pointerTrail.push(sample);
      const cutoff = sample.time - POINTER_TRAIL_MAX_AGE_MS;
      while (pointerTrail.length > 2 && pointerTrail[0]!.time < cutoff) {
        pointerTrail.shift();
      }
    }, { capture: true });

    const applyHitRegions = async (revision: number): Promise<boolean> => {
      if (revision !== hitRegionRevision || currentPayload?.requestUid !== payload.requestUid) {
        return false;
      }
      const rects = columns
        .filter((column) => column.isConnected)
        .map((column) => {
          const rect = column.getBoundingClientRect();
          return {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          };
        });
      try {
        await invoke("set_popup_hit_regions", { rects });
        return revision === hitRegionRevision;
      } catch {
        return false;
      }
    };

    const scheduleHitRegionUpdate = (): void => {
      const revision = ++hitRegionRevision;
      requestAnimationFrame(() => {
        void applyHitRegions(revision);
      });
    };

    const submenuSwitchDelay = (level: number): number => {
      const child = columns[level + 1];
      return child && isPointerHeadingToward(pointerTrail, child)
        ? SUBMENU_AIM_DELAY_MS
        : SUBMENU_SWITCH_DELAY_MS;
    };

    const dispatchAction = (actionUid: string): void => {
      void invoke("close_popup", { instanceUid, menuUid, windowUid });
      if (actionUid.startsWith("noop")) return;
      const action = payload.isFree
        ? invoke("invoke_free_action", { actionUid, instanceUid, menuUid })
        : invoke("invoke_action", { actionUid, instanceUid, windowUid });
      void action.catch(() => {});
    };

    const scheduleHover = (
      target: HTMLElement,
      open: () => void,
      delay: () => number = () => HOVER_OPEN_DELAY_MS,
    ): void => {
      const cancel = (): void => {
        if (hoverTarget !== target) return;
        clearTimeout(hoverTimer);
        hoverTimer = undefined;
        hoverTarget = undefined;
      };
      const schedule = (): void => {
        clearTimeout(hoverTimer);
        hoverTarget = target;
        hoverTimer = setTimeout(() => {
          if (hoverTarget !== target) return;
          hoverTimer = undefined;
          hoverTarget = undefined;
          if (target.isConnected && currentPayload?.requestUid === payload.requestUid) open();
        }, delay());
      };
      target.addEventListener("pointerenter", schedule);
      target.addEventListener("pointermove", () => {
        if (hoverTarget === target && hoverTimer) schedule();
      });
      target.addEventListener("pointerleave", cancel);
      target.addEventListener("pointercancel", cancel);
      target.addEventListener("pointerdown", cancel, { capture: true });
    };

    const buildColumn = (entries: LayoutEntry[], level: number): HTMLElement => {
      const column = document.createElement("div");
      column.className = "menu-column";
      column.addEventListener("pointerenter", () => setPopupPointerInside(true));
      column.addEventListener("pointerleave", (event) => {
        const related = event.relatedTarget as Element | null;
        if (related?.closest(".menu-column")) return;
        setPopupPointerInside(false);
      });
      column.style.maxHeight = `${payload.maxColumnHeight}px`;
      column.style.width = `${calculateColumnWidth(
        entries,
        payload.popupFontSize,
        payload.maxColumnHeight,
        payload.itemHeight,
      )}px`;
      column.dataset.columnWidth = column.style.width;
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
          const preferredDirection =
            entry.expandDirection === "left" || entry.expandDirection === "right"
              ? entry.expandDirection
              : payload.direction;
          button.dataset.expandDirection = preferredDirection;
          button.toggleAttribute("data-expanded", expandedUids[level] === entry.uid);
          const openChild = (): void => {
            setPopupPointerInside(true);
            if (expandedUids[level] === entry.uid && levels.length > level + 1) return;
            levels = [...levels.slice(0, level + 1), entry.children];
            expandedUids = [...expandedUids.slice(0, level), entry.uid];
            expandedDirections = [
              ...expandedDirections.slice(0, level),
              preferredDirection,
            ];
            renderLevels();
          };
          if (entry.expandOnHover !== false) {
            scheduleHover(
              button,
              openChild,
              () => levels.length > level + 1
                ? submenuSwitchDelay(level)
                : HOVER_OPEN_DELAY_MS,
            );
          } else {
            button.addEventListener("pointerdown", (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              if (expandedUids[level] === entry.uid) {
                levels = levels.slice(0, level + 1);
                expandedUids = expandedUids.slice(0, level);
                expandedDirections = expandedDirections.slice(0, level);
                renderLevels();
              } else {
                openChild();
              }
            });
          }
        } else {
          button.addEventListener("pointerenter", () => {
            setPopupPointerInside(true);
          });
          scheduleHover(button, () => {
            if (levels.length <= level + 1) return;
            levels = levels.slice(0, level + 1);
            expandedUids = expandedUids.slice(0, level);
            expandedDirections = expandedDirections.slice(0, level);
            renderLevels();
          }, () => submenuSwitchDelay(level));
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
        column.style.zIndex = String(level + 1);
        if (horizontal) {
          column.style.position = "absolute";
          if (level === 0) {
            column.style.left = `${payload.rootOffsetX}px`;
            column.style.top = "0px";
          } else {
            const parent = columns[level - 1]?.querySelector<HTMLElement>(
              `.menu-button[data-uid="${CSS.escape(expandedUids[level - 1] ?? "")}"]`,
            );
            if (parent) {
              const popupRect = popup.getBoundingClientRect();
              const parentRect = parent.getBoundingClientRect();
              const parentLeft = parentRect.left - popupRect.left;
              const parentRight = parentRect.right - popupRect.left;
              const columnWidth = Number.parseFloat(column.dataset.columnWidth ?? "0");
              const preferred = expandedDirections[level - 1] === "left" ? "left" : "right";
              const fitsPreferred = preferred === "left"
                ? parentLeft - columnWidth >= payload.workLeft
                : parentRight + columnWidth <= payload.workRight;
              const direction = fitsPreferred
                ? preferred
                : preferred === "left"
                  ? "right"
                  : "left";
              parent.dataset.expandDirection = direction;
              const left = direction === "left"
                ? parentLeft - columnWidth
                : parentRight;
              const top = parentRect.top - popupRect.top;
              column.style.left = `${left}px`;
              column.style.top = `${Math.max(0, top)}px`;
              column.style.maxHeight = `${Math.max(
                MIN_COLUMN_HEIGHT,
                payload.maxColumnHeight - Math.max(0, top),
              )}px`;
            }
          }
        } else if (level > 0) {
          const parent = columns[level - 1]?.querySelector<HTMLElement>(
            `.menu-button[data-uid="${CSS.escape(expandedUids[level - 1] ?? "")}"]`,
          );
          if (parent) {
            const popupRect = popup.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            if (payload.direction === "up") {
              const marginBottom = Math.min(
                Math.max(0, popupRect.bottom - parentRect.bottom),
                Math.max(0, popupRect.height - MIN_COLUMN_HEIGHT),
              );
              column.style.marginBottom = `${marginBottom}px`;
              column.style.maxHeight = `${Math.max(
                MIN_COLUMN_HEIGHT,
                popupRect.height - marginBottom,
              )}px`;
            } else {
              const marginTop = Math.min(
                Math.max(0, parentRect.top - popupRect.top),
                Math.max(0, popupRect.height - MIN_COLUMN_HEIGHT),
              );
              column.style.marginTop = `${marginTop}px`;
              column.style.maxHeight = `${Math.max(
                MIN_COLUMN_HEIGHT,
                popupRect.height - marginTop,
              )}px`;
            }
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
      scheduleHitRegionUpdate();
    };

    root.replaceChildren(popup);
    renderLevels();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (currentPayload?.requestUid !== payload.requestUid) return;
        const revision = ++hitRegionRevision;
        void applyHitRegions(revision).then((applied) => {
          if (!applied || currentPayload?.requestUid !== payload.requestUid) return;
          void invoke("show_popup", {
            instanceUid,
            menuUid,
            requestUid: payload.requestUid,
            windowUid,
          });
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

function isPointerHeadingToward(
  pointerTrail: PointerSample[],
  child: HTMLElement,
): boolean {
  const current = pointerTrail.at(-1);
  if (!current) return false;

  let previous: PointerSample | undefined;
  for (const sample of pointerTrail) {
    if (sample === current) break;
    if (Math.hypot(current.x - sample.x, current.y - sample.y) >= 4) {
      previous = sample;
      break;
    }
  }
  if (!previous) return false;

  const childRect = child.getBoundingClientRect();
  const childIsRight = childRect.left >= current.x;
  const childIsLeft = childRect.right <= current.x;
  if (!childIsRight && !childIsLeft) return false;

  const direction = childIsRight ? 1 : -1;
  const movementX = (current.x - previous.x) * direction;
  if (movementX <= 0) return false;

  const nearEdgeX = childIsRight ? childRect.left : childRect.right;
  const remainingX = (nearEdgeX - current.x) * direction;
  const projectedY = current.y +
    ((current.y - previous.y) / movementX) * Math.max(0, remainingX);
  const tolerance = 8;
  return projectedY >= childRect.top - tolerance &&
    projectedY <= childRect.bottom + tolerance;
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
  const maxWidth = Math.round(
    BASE_MAX_COLUMN_WIDTH * Math.max(1, fontSize / BASE_POPUP_FONT_SIZE),
  );
  return Math.min(maxWidth, Math.max(72, Math.ceil(width + 20) + scrollbarBuffer));
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
