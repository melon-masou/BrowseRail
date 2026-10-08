import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createLifetime, createTextMeasure, planFolderPopup,
  type PopupRequest, type PopupSession, type Rect, type PopupPin,
} from "@browserail/menu-ui";

interface Context { instanceUid: string; menuUid: string; windowUid: string; isFree: boolean; parentLabel: string }
interface PopupReady { requestUid: string; error?: string }

export async function createTauriPopupLink(root: HTMLElement, context: Context) {
  const { instanceUid, menuUid, windowUid, isFree, parentLabel } = context;
  const lifetime = createLifetime(root);
  const measure = createTextMeasure(root, lifetime);
  let active: {
    requestUid: string; ready(): void; fail(error: unknown): void; closed(): void;
    finished: Promise<void>; closing: boolean;
    pointerInside: ((inside: boolean) => void) | undefined;
    pinChanged: ((pin: PopupPin, rootPin: PopupPin) => void) | undefined;
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
  const unlistenPointer = await listen<{ requestUid: string; inside: boolean }>("popup-pointer-inside", ({ payload }) => {
    if (active?.requestUid === payload.requestUid && !active.closing) active.pointerInside?.(payload.inside);
  }, { target: parentLabel });
  const unlistenPinned = await listen<{ requestUid: string; pin: PopupPin; rootPin: PopupPin }>("popup-pin-changed", ({ payload }) => {
    if (active?.requestUid === payload.requestUid && !active.closing) active.pinChanged?.(payload.pin, payload.rootPin);
  }, { target: parentLabel });
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
    async open(request: PopupRequest, pointerInside?: (inside: boolean) => void, pinChanged?: (pin: PopupPin, rootPin: PopupPin) => void): Promise<PopupSession> {
      assertAlive();
      await whileAlive(closeActive());
      assertAlive();
      const bounds = await whileAlive(invoke<Rect>("surface_work_area"));
      await whileAlive(lifetime.settle());
      assertAlive();
      const { surface, state } = planFolderPopup(measure, request, bounds);
      const requestUid = crypto.randomUUID();
      let resolveReady!: () => void;
      let rejectReady!: (error: unknown) => void;
      let resolveClosed!: () => void;
      const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
      const opened = { requestUid, ready: resolveReady, fail: rejectReady, closed: resolveClosed, finished: closed, closing: false, pointerInside, pinChanged };
      active = opened;
      // Attach rejection handling before the native command can emit a close event.
      const nativeOpen = invoke("open_popup", {
        request: {
          anchor: { x: surface.left, y: surface.top },
          barPointerInside: root.querySelector(".menu-bar:not(.is-editing)")?.matches(":hover") === true,
          height: surface.bottom - surface.top, instanceUid, menuUid, parentLabel,
          payload: { state, isFree, requestUid, parentLabel, pin: request.pin },
          requestUid, width: surface.right - surface.left, windowUid,
          pin: request.pin,
        },
      });
      try { await Promise.all([nativeOpen, ready]); }
      catch (error) {
        if (active === opened) await closeActive();
        throw error;
      }
      return {
        togglePin: async pin => {
          if (active !== opened || opened.closing) return;
          await command("toggle_popup_pin", { requestUid, pin });
        },
        dismiss: async () => {
          if (active === opened && !opened.closing) await command("dismiss_popup", { requestUid });
        },
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
      unlistenPointer();
      unlistenPinned();
      active?.fail(new Error("Popup host was destroyed"));
      active?.closed();
      active = undefined;
      if (hadPopup) report(command("close_popup"));
    },
  };
}
