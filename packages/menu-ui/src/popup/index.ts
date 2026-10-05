import { invertNavigationActionUid, type ExpandDirection, type LayoutEntry } from "@browserail/protocol";
import { applyMenuColor, applyFolderPin, menuButton } from "../appearance";
import { calculateColumnWidth as columnWidth, createTextMeasure, submenuHeightLimit } from "./layout";
import { createLifetime, showMenuError, type Lifetime } from "../lifetime";
import { attachTemporaryBookmarkButton } from "../temporary-bookmark";
import type { PopupController, PopupHost, PopupState, Rect, FolderPin } from "../types";

interface PointerSample { time: number; x: number; y: number }
const HOVER_OPEN_DELAY_MS = 60;
const SUBMENU_SWITCH_DELAY_MS = 180;
const SUBMENU_AIM_DELAY_MS = 320;
const POINTER_TRAIL_MAX_AGE_MS = 180;

export function mountFolderPopup(root: HTMLElement, initial: PopupState, host: PopupHost): PopupController {
  const doc = root.ownerDocument;
  const lifetime = createLifetime(root, host.waitForFonts);
  let renderLifetime = createLifetime(root, host.waitForFonts);
  const measure = createTextMeasure(root, lifetime);
  let state = initial;
  let revision = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverTarget: HTMLElement | undefined;
  let toggleRootPin: (pin: FolderPin) => void;
  let dismiss: () => void;
  let commitCurrent: () => Promise<void>;
  const run = (action: Promise<void>): void => {
    void action.catch(error => { if (lifetime.alive) showMenuError(root, error); });
  };
  const calculateColumnWidth = (entries: LayoutEntry[], fontSize: number, maxHeight: number, itemHeight: number): number =>
    columnWidth(measure, entries, fontSize, maxHeight, itemHeight);
  render(state);
  return {
    ready: commitCurrent!(),
    toggleRootPin(pin): void { if (lifetime.alive) toggleRootPin(pin); },
    dismiss(): void { if (lifetime.alive) dismiss(); },
    async update(next): Promise<void> {
      if (!lifetime.alive) return;
      const sameLayout = next.entries === state.entries && next.direction === state.direction
        && next.rootDirection === state.rootDirection && next.rootOffsetX === state.rootOffsetX
        && next.rootOffsetY === state.rootOffsetY
        && next.expandAlignment === state.expandAlignment && next.rootExpandOnHover === state.rootExpandOnHover
        && next.maxColumnHeight === state.maxColumnHeight && next.bounds === state.bounds
        && next.theme.fontSize === state.theme.fontSize && next.theme.itemHeight === state.theme.itemHeight
        && next.theme.color === state.theme.color;
      state = next;
      if (sameLayout) root.style.setProperty("--menu-font-family", next.theme.fontFamily);
      else render(next);
      await commitCurrent();
    },
    destroy(): void {
      revision++;
      lifetime.destroy();
      renderLifetime.destroy();
      root.replaceChildren();
      root.classList.remove("browserail-menu-ui", "popup-surface");
    },
  };

  function render(next: PopupState): void {
    renderLifetime.destroy();
    renderLifetime = createLifetime(root, host.waitForFonts);
    const token = ++revision;
    const payload = {
      ...next,
      color: next.theme.color,
      popupFontSize: next.theme.fontSize,
      itemHeight: next.theme.itemHeight,
      workLeft: next.bounds.left,
      workRight: next.bounds.right,
    };
    root.style.setProperty("--menu-font-family", next.theme.fontFamily);
    root.removeAttribute("data-popup-content-hidden");
    hoverTimer = undefined;
    hoverTarget = undefined;
    root.classList.add("browserail-menu-ui", "popup-surface");
    root.style.setProperty("--menu-font-size", `${payload.popupFontSize}px`);
    root.style.setProperty("--menu-item-height", `${payload.itemHeight}px`);

    const popup = doc.createElement("div");
    popup.className = "popup-container detached-popup";
    popup.dataset.direction = payload.rootDirection;
    popup.ariaLabel = "BrowseRail bookmark menu";
    popup.style.display = "block";
    popup.style.height = "100%";
    let levels: LayoutEntry[][] = [payload.entries];
    const pins = new Map<number, FolderPin>();
    if (host.pin !== "none") pins.set(0, host.pin);
    const pinnedThrough = (): number => Math.max(-1, ...pins.keys());
    const lockedFrom = (level: number): boolean => Array.from(pins).some(([depth, pin]) => depth >= level && pin === "locked");
    const publishPin = (): void => {
      updatePinMarkers();
      run(host.setPin(lockedFrom(0) ? "locked" : pins.size ? "temporary" : "none", pins.get(0) ?? "none"));
    };
    const togglePin = (level: number, pin: FolderPin): void => {
      const current = pins.get(level);
      if (current === "locked" || (current === "temporary" && pin === "temporary")) {
        pins.delete(level);
        for (const [depth, value] of pins) if (depth > level && value !== "locked") pins.delete(depth);
      } else {
        if (pin === "temporary") {
          for (let ancestor = 0; ancestor < level; ancestor++) if (!pins.has(ancestor)) pins.set(ancestor, "temporary");
        }
        pins.set(level, pin);
      }
      publishPin();
    };
    toggleRootPin = pin => {
      if (pin === "locked" || payload.rootExpandOnHover !== false || pins.get(0) === "locked") togglePin(0, pin);
    };
    let expandedUids: string[] = [];
    let expandedDirections: ExpandDirection[] = [];
    const columns: HTMLElement[] = [];
    const updatePinMarkers = (): void => {
      for (let level = 0; level < columns.length; level++) {
        for (const button of columns[level]!.querySelectorAll<HTMLElement>(".menu-button[data-uid]")) {
          applyFolderPin(button, button.dataset.uid === expandedUids[level] ? pins.get(level + 1) ?? "none" : "none");
        }
      }
    };
    const columnDisposers = new WeakMap<HTMLElement, () => void>();
    const renderedLevels: LayoutEntry[][] = [];
    const pointerTrail: PointerSample[] = [];
    let hitRegionRevision = 0;
    const setPopupPointerInside = (inside: boolean): void => {
      if (!inside && pins.size) trimLevels(pinnedThrough() + 1);
      host.setPointerInside(inside);
    };

    const trimLevels = (count: number): void => {
      if (levels.length <= count) return;
      levels = levels.slice(0, count);
      expandedUids = expandedUids.slice(0, count - 1);
      expandedDirections = expandedDirections.slice(0, count - 1);
      renderLevels();
    };
    dismiss = (): void => {
      if (!lockedFrom(0)) { run(host.close()); return; }
      for (const [depth, pin] of pins) if (pin !== "locked") pins.delete(depth);
      trimLevels(pinnedThrough() + 1);
      publishPin();
    };
    popup.addEventListener("contextmenu", event => event.preventDefault(), { signal: renderLifetime.signal });

    popup.addEventListener("wheel", event => {
      if (event.ctrlKey) return;
      event.stopPropagation();
      // Columns scroll natively; the popup's gaps must not scroll the host page.
      const path = event.composedPath();
      if (!columns.some(column => path.includes(column))) event.preventDefault();
    }, { passive: false, signal: renderLifetime.signal });

    popup.addEventListener("pointermove", (event) => {
      const sample = { time: event.timeStamp, x: event.clientX, y: event.clientY };
      pointerTrail.push(sample);
      const cutoff = sample.time - POINTER_TRAIL_MAX_AGE_MS;
      while (pointerTrail.length > 2 && pointerTrail[0]!.time < cutoff) {
        pointerTrail.shift();
      }
    }, { capture: true, signal: renderLifetime.signal });

    const applyLayout = async (layoutRevision: number): Promise<void> => {
      if (!lifetime.alive || layoutRevision !== hitRegionRevision || token !== revision) return;
      await host.commitLayout({ columns: columns.filter(column => column.isConnected).map(column => layoutRect(column)) });
    };
    commitCurrent = async () => {
      const layoutRevision = ++hitRegionRevision;
      if (!await renderLifetime.settle() || layoutRevision !== hitRegionRevision || token !== revision) return;
      layoutColumns();
      if (!await renderLifetime.frame() || layoutRevision !== hitRegionRevision || token !== revision) return;
      await applyLayout(layoutRevision);
    };
    const scheduleHitRegionUpdate = (): void => {
      const layoutRevision = ++hitRegionRevision;
      void renderLifetime.frame().then(alive => {
        if (alive) run(applyLayout(layoutRevision));
      });
    };

    const submenuSwitchDelay = (level: number): number => {
      const child = columns[level + 1];
      return child && isPointerHeadingToward(pointerTrail, child)
        ? SUBMENU_AIM_DELAY_MS
        : SUBMENU_SWITCH_DELAY_MS;
    };

    const dispatchAction = (actionUid: string): void => {
      dismiss();
      if (!actionUid.startsWith("noop")) run(host.invokeAction(actionUid));
    };

    const scheduleHover = (
      columnLifetime: Lifetime,
      target: HTMLElement,
      open: () => void,
      delay: () => number = () => HOVER_OPEN_DELAY_MS,
    ): void => {
      const cancel = (): void => {
        if (hoverTarget !== target) return;
        columnLifetime.cancelTimeout(hoverTimer);
        hoverTimer = undefined;
        hoverTarget = undefined;
      };
      const schedule = (): void => {
        columnLifetime.cancelTimeout(hoverTimer);
        hoverTarget = target;
        hoverTimer = columnLifetime.timeout(() => {
          if (hoverTarget !== target) return;
          hoverTimer = undefined;
          hoverTarget = undefined;
          if (target.isConnected && token === revision) open();
        }, delay());
      };
      target.addEventListener("pointerenter", schedule, { signal: columnLifetime.signal });
      target.addEventListener("pointermove", () => {
        if (hoverTarget === target && hoverTimer) schedule();
      }, { signal: columnLifetime.signal });
      target.addEventListener("pointerleave", cancel, { signal: columnLifetime.signal });
      target.addEventListener("pointercancel", cancel, { signal: columnLifetime.signal });
      target.addEventListener("pointerdown", cancel, { capture: true, signal: columnLifetime.signal });
    };

    const buildColumn = (entries: LayoutEntry[], level: number): HTMLElement => {
      const column = doc.createElement("div");
      const columnLifetime = createLifetime(root);
      const unregister = renderLifetime.onDestroy(() => columnLifetime.destroy());
      columnLifetime.onDestroy(unregister);
      columnDisposers.set(column, () => columnLifetime.destroy());
      column.className = "menu-column";
      column.addEventListener("pointerenter", () => setPopupPointerInside(true), { signal: columnLifetime.signal });
      column.addEventListener("pointerleave", (event) => {
        const related = event.relatedTarget as Element | null;
        if (related && popup.contains(related) && related.closest(".menu-column")) return;
        setPopupPointerInside(false);
      }, { signal: columnLifetime.signal });
      column.style.maxHeight = `${payload.maxColumnHeight}px`;
      if (payload.color) {
        column.dataset.accent = "true";
        applyMenuColor(column, payload.color);
      }

      for (const entry of entries) {
        if (entry.kind !== "bookmark" && entry.kind !== "folder") continue;
        const button = menuButton(doc, entry, true);
        if (entry.kind === "folder") {
          button.dataset.uid = entry.uid;
          const preferredDirection =
            entry.expandDirection === "left" || entry.expandDirection === "right"
              ? entry.expandDirection
              : payload.direction;
          button.dataset.expandDirection = preferredDirection;
          button.toggleAttribute("data-expanded", expandedUids[level] === entry.uid);
          const openChild = (pin?: FolderPin, clicked = false): void => {
            const sameFolder = expandedUids[level] === entry.uid;
            if (!sameFolder && lockedFrom(level + 1)) return;
            if (!pin && !clicked && level < pinnedThrough()) return;
            if (!sameFolder && clicked) {
              const changed = pins.size;
              for (const depth of pins.keys()) if (depth > level) pins.delete(depth);
              if (changed !== pins.size) publishPin();
            }
            if (pin) togglePin(level + 1, pin);
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
              columnLifetime, button,
              () => openChild(),
              () => levels.length > level + 1
                ? submenuSwitchDelay(level)
                : HOVER_OPEN_DELAY_MS,
            );
          }
          button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 && event.button !== 2) return;
            event.preventDefault();
            if (event.button === 2 || entry.expandOnHover !== false || pins.get(level + 1) === "locked") {
              openChild(event.button === 2 ? "locked" : "temporary", true);
            } else if (expandedUids[level] === entry.uid) {
              if (lockedFrom(level + 1)) return;
              const changed = pins.size;
              for (const depth of pins.keys()) if (depth > level) pins.delete(depth);
              if (changed !== pins.size) publishPin();
              trimLevels(level + 1);
            } else openChild(undefined, true);
          }, { signal: columnLifetime.signal });
        } else {
          button.addEventListener("pointerenter", () => {
            setPopupPointerInside(true);
          }, { signal: columnLifetime.signal });
          scheduleHover(columnLifetime, button, () => {
            const keep = Math.max(level + 1, pinnedThrough() + 1);
            if (levels.length <= keep) return;
            levels = levels.slice(0, keep);
            expandedUids = expandedUids.slice(0, keep - 1);
            expandedDirections = expandedDirections.slice(0, keep - 1);
            renderLevels();
          }, () => submenuSwitchDelay(level));
          if (entry.uid.startsWith("temporary:")) {
            const dispose = attachTemporaryBookmarkButton(
              button,
              entry,
              {
                invokeAction: async uid => { dispatchAction(uid); },
                requestTemporarySave: input => host.requestTemporarySave(input),
              },
              { onShortPress: () => dispatchAction(entry.uid), canAlternate: () => state.editingLocked },
            );
            columnLifetime.onDestroy(dispose);
          } else {
            button.addEventListener("pointerdown", (event) => {
              if (event.button === 0) {
                event.preventDefault();
                dispatchAction(entry.uid);
              } else if (event.button === 2 && state.editingLocked) {
                event.preventDefault();
                event.stopPropagation();
                dispatchAction(invertNavigationActionUid(entry.uid));
              }
            }, { signal: columnLifetime.signal });
          }
        }
        column.appendChild(button);
      }
      return column;
    };

    const layoutColumns = (): void => {
      const popupRect = popup.getBoundingClientRect();
      const availableWidth = Math.max(1, payload.bounds.right - payload.bounds.left);
      for (let level = 0; level < columns.length; level++) {
        const column = columns[level]!;
        const setWidth = (maxHeight: number): void => {
          column.style.width = `${Math.min(calculateColumnWidth(
            levels[level]!, payload.popupFontSize, maxHeight, payload.itemHeight,
          ), availableWidth)}px`;
        };
        setWidth(payload.maxColumnHeight);
        column.style.minWidth = "0px";
        column.style.maxWidth = `${availableWidth}px`;
        column.style.position = "absolute";
        if (level === 0) {
          const width = Number.parseFloat(column.style.width);
          column.style.left = `${Math.max(payload.bounds.left, Math.min(payload.rootOffsetX, payload.bounds.right - width))}px`;
          if (payload.direction === "up") column.style.bottom = `${popupRect.height - payload.rootOffsetY}px`;
          else if (payload.expandAlignment === "center" && (payload.direction === "left" || payload.direction === "right")) {
            const height = column.getBoundingClientRect().height;
            column.style.top = `${Math.max(payload.bounds.top, Math.min(payload.rootOffsetY - height / 2, payload.bounds.bottom - height))}px`;
          } else column.style.top = `${payload.rootOffsetY}px`;
          continue;
        }
        const parent = columns[level - 1]?.querySelector<HTMLElement>(
          `.menu-button[data-uid="${CSS.escape(expandedUids[level - 1] ?? "")}"]`,
        );
        if (!parent) continue;
        const parentRect = layoutRect(parent, columns[level - 1]!);
        const parentTop = parentRect.top - popupRect.top;
        const parentBottom = parentRect.bottom - popupRect.top;
        const parentLeft = parentRect.left - popupRect.left;
        const parentRight = parentRect.right - popupRect.left;
        const centered = payload.expandAlignment === "center";
        const parentCenter = (parentTop + parentBottom) / 2;
        const available = centered
          ? 2 * Math.min(parentCenter - payload.bounds.top, payload.bounds.bottom - parentCenter)
          : payload.direction === "up" ? parentBottom - payload.bounds.top : payload.bounds.bottom - parentTop;
        const contentHeight = column.scrollHeight + column.offsetHeight - column.clientHeight;
        const maxHeight = Math.min(payload.bounds.bottom - payload.bounds.top,
          contentHeight <= available ? available : submenuHeightLimit(payload.itemHeight));
        column.style.maxHeight = `${maxHeight}px`;
        setWidth(maxHeight);
        const columnWidth = Number.parseFloat(column.style.width);
        const preferred = expandedDirections[level - 1] === "left" ? "left" : "right";
        const fitsPreferred = preferred === "left"
          ? parentLeft - columnWidth >= payload.bounds.left
          : parentRight + columnWidth <= payload.bounds.right;
        const direction = fitsPreferred ? preferred : preferred === "left" ? "right" : "left";
        parent.dataset.expandDirection = direction;
        const left = direction === "left" ? parentLeft - columnWidth : parentRight;
        column.style.left = `${Math.max(payload.bounds.left, Math.min(left, payload.bounds.right - columnWidth))}px`;
        const height = column.getBoundingClientRect().height;
        const preferredTop = centered ? parentCenter - height / 2 : payload.direction === "up" ? parentBottom - height : parentTop;
        column.style.top = `${Math.max(payload.bounds.top, Math.min(preferredTop, payload.bounds.bottom - height))}px`;
      }
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
        const removed = columns[index];
        if (removed) { columnDisposers.get(removed)?.(); removed.remove(); }
      }
      columns.length = diffFrom;
      renderedLevels.length = diffFrom;

      for (let level = diffFrom; level < levels.length; level++) {
        const column = buildColumn(levels[level]!, level);
        column.style.zIndex = String(level + 1);
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
      updatePinMarkers();
      layoutColumns();
      scheduleHitRegionUpdate();
    };

    root.replaceChildren(popup);
    renderLevels();
  }
}

function layoutRect(element: HTMLElement, animatedColumn: HTMLElement = element): Rect {
  const rect = element.getBoundingClientRect();
  // Native keeps this region after the entrance animation, so use the resting
  // position for clipping and for positioning the next column.
  const transform = element.ownerDocument.defaultView!.getComputedStyle(animatedColumn).transform;
  const matrix = transform && transform !== "none" ? new DOMMatrixReadOnly(transform) : undefined;
  const x = matrix?.m41 ?? 0;
  const y = matrix?.m42 ?? 0;
  return { left: rect.left - x, top: rect.top - y, right: rect.right - x, bottom: rect.bottom - y };
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
