import { mountFolderPopup, type PopupController, type PopupState, type PopupHost, type PopupPin, type FolderPin } from "@browserail/menu-ui";
import { invoke } from "@tauri-apps/api/core";
import { listen, emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface PopupPayload {
  state: PopupState;
  isFree: boolean;
  requestUid: string;
  parentLabel: string;
  pin: PopupPin;
}

interface PopupSurfaceState {
  payload?: PopupPayload;
}

export async function initializePopupSurface(): Promise<void> {
  const query = new URLSearchParams(location.search);
  const instanceUid = requiredQuery(query, "instanceUid");
  const menuUid = requiredQuery(query, "menuUid");
  const windowUid = requiredQuery(query, "windowUid", true);
  const surfaceLabel = getCurrentWindow().label;
  const root = requiredElement("app");
  document.body.dataset.surface = "popup";
  let currentPayload: PopupPayload | undefined;
  let currentState: PopupState | undefined;
  let renderer: PopupController | undefined;
  let receivedStateEvent = false;
  let destroyed = false;
  let pin: PopupPin = "none";
  const disposers: Array<() => void> = [];
  const report = (action: Promise<void>): void => {
    void action.catch(error => { if (!destroyed) { root.title = String(error); root.dataset.error = ""; } });
  };
  const host: PopupHost = {
    get pin() { return pin; },
    async setPin(next, rootPin) {
      if (!currentPayload) return;
      pin = next;
      await invoke("set_popup_pin", { instanceUid, menuUid, windowUid, requestUid: currentPayload.requestUid, pin, rootPin });
    },
    invokeAction: actionUid => currentPayload?.isFree
      ? invoke("invoke_free_action", { actionUid, instanceUid, menuUid })
      : invoke("invoke_action", { actionUid, instanceUid, windowUid, menuUid }),
    requestToggleFold: () => invoke("toggle_menu_collapsed", { instanceUid, menuUid }),
    requestTemporarySave: input => invoke("open_temporary_confirmation", {
      instanceUid, menuUid, windowUid: currentPayload?.isFree ? null : windowUid, ...input,
    }),
    close: () => invoke("close_popup", { instanceUid, menuUid, windowUid }),
    setPointerInside: inside => {
      report(invoke("set_popup_pointer_inside", { inside, instanceUid, menuUid, source: "popup", windowUid }));
      if (currentPayload) report(emitTo(currentPayload.parentLabel, "popup-pointer-inside", {
        requestUid: currentPayload.requestUid, inside,
      }));
    },
    commitLayout: layout => invoke("set_popup_hit_regions", { rects: layout.columns }),
  };
  async function render(payload: PopupPayload): Promise<void> {
    if (currentPayload?.requestUid !== payload.requestUid) pin = payload.pin;
    currentPayload = payload;
    currentState = payload.state;
    try {
      if (renderer) await renderer.update(currentState);
      else { renderer = mountFolderPopup(root, currentState, host); await renderer.ready; }
      if (destroyed || currentPayload !== payload) return;
      await invoke("show_popup", { instanceUid, menuUid, requestUid: payload.requestUid, windowUid });
    } catch (error) {
      if (!destroyed && currentPayload === payload) {
        await emitTo(payload.parentLabel, "popup-ready", { requestUid: payload.requestUid, error: String(error) });
      }
      throw error;
    }
  }
  disposers.push(await listen<PopupPayload>("popup-state", ({ payload }) => {
    receivedStateEvent = true;
    report(render(payload));
  }, { target: surfaceLabel }));
  disposers.push(await listen<boolean>("popup-content-visibility", ({ payload }) => {
    root.toggleAttribute("data-popup-content-hidden", !payload);
  }, { target: surfaceLabel }));
  disposers.push(await listen<{ requestUid: string; pin: FolderPin }>("popup-toggle-pin", ({ payload }) => {
    if (currentPayload?.requestUid === payload.requestUid) renderer?.toggleRootPin(payload.pin);
  }, { target: surfaceLabel }));
  disposers.push(await listen<{ requestUid: string }>("popup-dismiss", ({ payload }) => {
    if (currentPayload?.requestUid === payload.requestUid) renderer?.dismiss();
  }, { target: surfaceLabel }));
  disposers.push(await listen<boolean>("editing-lock-changed", ({ payload }) => {
    if (!currentState || !renderer) return;
    currentState = { ...currentState, editingLocked: payload };
    report(renderer.update(currentState));
  }));
  const state = await invoke<PopupSurfaceState>("surface_state", { instanceUid, menuUid, surface: "popup", windowUid });
  if (state.payload && !receivedStateEvent) await render(state.payload);
  window.addEventListener("pagehide", () => {
    destroyed = true;
    renderer?.destroy();
    for (const dispose of disposers) dispose();
  }, { once: true });
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
