import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  calculateColumnWidth, createLifetime, createTextMeasure,
  popupEnvelope as measureEnvelope, MIN_COLUMN_HEIGHT, POPUP_SCREEN_MARGIN,
  type PopupRequest, type PopupSession,
} from "@browserail/menu-ui";

interface Context { instanceUid: string; menuUid: string; windowUid: string; isFree: boolean; parentLabel: string }
interface HorizontalSpace {
  left: number; right: number; windowLeft: number; workLeft: number; workRight: number;
}
interface PopupReady { requestUid: string; error?: string }

export async function createTauriPopupLink(root: HTMLElement, context: Context) {
  const { instanceUid, menuUid, windowUid, isFree, parentLabel } = context;
  const lifetime = createLifetime(root);
  const measure = createTextMeasure(root, lifetime);
  let active: {
    requestUid: string; ready(): void; fail(error: unknown): void; closed(): void;
    finished: Promise<void>; closing: boolean;
  } | undefined;
  const unlistenClosed = await listen<string>("popup-closed", ({ payload }) => {
    if (payload !== menuUid) return;
    active?.fail(new Error("Popup closed before it was ready"));
    active?.closed();
    active = undefined;
  }, { target: parentLabel });
  const unlistenReady = await listen<PopupReady>("popup-ready", ({ payload }) => {
    if (active?.requestUid !== payload.requestUid) return;
    if (payload.error) active.fail(new Error(payload.error));
    else active.ready();
  }, { target: parentLabel });
  async function getAvailableHeight(above: boolean): Promise<number> {
    const height = await invoke<number>("surface_available_height", { above });
    if (!Number.isFinite(height) || height <= 0) throw new Error("Surface available height is unavailable");
    return height;
  }
  const command = (name: string, args = {}): Promise<void> => invoke(name, { instanceUid, menuUid, windowUid, ...args });
  const report = (action: Promise<void>): void => {
    void action.catch(error => { if (lifetime.alive) { root.dataset.error = ""; root.title = String(error); } });
  };
  function assertAlive(): void {
    if (!lifetime.alive) throw new Error("Popup host was destroyed");
  }
  async function whileAlive<T>(action: Promise<T>): Promise<T> {
    assertAlive();
    let cancel!: () => void;
    const destroyed = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Popup host was destroyed"));
      lifetime.signal.addEventListener("abort", cancel, { once: true });
    });
    try { return await Promise.race([action, destroyed]); }
    finally { lifetime.signal.removeEventListener("abort", cancel); }
  }
  async function closeActive(): Promise<void> {
    const closing = active;
    if (!closing) return;
    if (!closing.closing) {
      closing.closing = true;
      await command("close_popup");
    }
    await closing.finished;
  }
  return {
    async open(request: PopupRequest): Promise<PopupSession> {
      assertAlive();
      await whileAlive(closeActive());
      assertAlive();
      const entry = request.folder;
      const anchor = request.anchor;
      const theme = request.theme;
      const direction = request.direction;
      const popupGap = 0;
      const availableHeight = await whileAlive(getAvailableHeight(direction === "up"));
      await whileAlive(lifetime.settle());
      assertAlive();

      const popupTop = direction === "down" ? anchor.bottom + popupGap : anchor.top;
      const maxColumnHeight = Math.max(
        MIN_COLUMN_HEIGHT,
        direction === "up"
          ? availableHeight + anchor.top - popupGap - POPUP_SCREEN_MARGIN
          : availableHeight - popupTop - POPUP_SCREEN_MARGIN,
      );

      const envelope = measureEnvelope(measure, entry.children, theme.fontSize, theme.itemHeight, maxColumnHeight, direction);
      const rootColumnWidth = calculateColumnWidth(measure, entry.children, theme.fontSize, maxColumnHeight, theme.itemHeight);
      let rootDirection = direction;
      let popupWidth = envelope.width;
      let popupX = anchor.left;
      let rootOffsetX = 0;
      let workLeft = 0;
      let workRight = popupWidth;
      if (direction === "left" || direction === "right") {
          const space = await whileAlive(invoke<HorizontalSpace>("surface_horizontal_space", { anchorLeft: anchor.left, anchorRight: anchor.right }));
          assertAlive();
          const preferredSpace = direction === "left" ? space.left : space.right;
          if (rootColumnWidth + popupGap > preferredSpace) {
            rootDirection = direction === "left" ? "right" : "left";
          }
          const sideReserve = Math.max(0, envelope.width - rootColumnWidth);
          popupWidth = sideReserve * 2 + rootColumnWidth;
          rootOffsetX = sideReserve;
          const rootX =
            rootDirection === "left"
              ? anchor.left - popupGap - rootColumnWidth
              : anchor.right + popupGap;
          popupX = rootX - rootOffsetX;
          const popupScreenX = space.windowLeft + popupX;
          workLeft = space.workLeft - popupScreenX;
          workRight = space.workRight - popupScreenX;
      }
      const x = direction === "left" || direction === "right" ? popupX : anchor.left;
      const y =
        direction === "up"
          ? anchor.top - popupGap - envelope.height
          : direction === "down"
            ? anchor.bottom + popupGap
            : anchor.top;
      const requestUid = crypto.randomUUID();
      let resolveReady!: () => void;
      let rejectReady!: (error: unknown) => void;
      let resolveClosed!: () => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
      const opened = { requestUid, ready: resolveReady, fail: rejectReady, closed: resolveClosed, finished: closed, closing: false };
      active = opened;
      // Attach rejection handling before the native command can emit a close event.
      const nativeOpen = invoke("open_popup", {
        request: {
          anchor: { x, y },
          barPointerInside: root.querySelector(".menu-bar")?.matches(":hover") === true,
          height: envelope.height, instanceUid, menuUid, parentLabel,
          payload: {
            color: theme.color, direction, editingLocked: request.editingLocked,
            entries: entry.children, isFree, itemHeight: theme.itemHeight,
            maxColumnHeight, popupFontSize: theme.fontSize, requestUid,
            rootDirection, rootOffsetX, workLeft, workRight, parentLabel,
          },
          requestUid, width: popupWidth, windowUid,
        },
      });
      try { await Promise.all([nativeOpen, ready]); }
      catch (error) {
        if (active === opened) await closeActive();
        throw error;
      }
      return {
        closed,
        close: async () => {
          if (active !== opened) return;
          await closeActive();
        },
        requestClose: () => { if (active === opened) report(command("schedule_popup_close")); },
        cancelClose: () => { if (active === opened) report(command("cancel_popup_close")); },
        setBarPointerInside: inside => {
          if (active === opened) report(command("set_popup_pointer_inside", { source: "bar", inside }));
        },
      };
    },
    async close(): Promise<void> {
      await closeActive();
    },
    destroy(): void {
      if (!lifetime.alive) return;
      const hadPopup = active !== undefined;
      lifetime.destroy();
      unlistenClosed();
      unlistenReady();
      active?.fail(new Error("Popup host was destroyed"));
      active?.closed();
      active = undefined;
      if (hadPopup) report(command("close_popup"));
    },
  };
}
