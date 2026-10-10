import { t } from "@browserail/i18n";
import { mountBar, resolveFontFamily, barSurfaceDimensions, barToggleOffset, type MenuActions, type PopupSession } from "@browserail/menu-ui";
import type { BrowserMenu, MenuRequest, MenuCommandResult } from "@browserail/protocol/content";
import { openBrowserPopup } from "./popup";
import { mountBrowserCustomization } from "./customization";
import { placementStyle } from "./placement";

export type MenuCommand = MenuRequest;

export function mountBrowserMenu(container: HTMLElement, initial: BrowserMenu, send: (command: MenuCommand) => Promise<MenuCommandResult | undefined>) {
  const doc = container.ownerDocument;
  const viewport = doc.defaultView!;
  const lifetime = new AbortController();
  const wrapper = doc.createElement("div"); wrapper.className = "browser-bar"; wrapper.style.visibility = "hidden";
  const root = doc.createElement("div");
  wrapper.append(root); container.append(wrapper);
  let state = initial;
  let popup: PopupSession | undefined;
  let editor: ReturnType<typeof mountBrowserCustomization> | undefined;
  let editToken: string | undefined;
  let startingEdit = false;
  const report = (action: Promise<void>): void => {
    void action.catch(error => { if (!lifetime.signal.aborted) { wrapper.title = String(error); root.dataset.error = ""; } });
  };
  const closePopup = async (): Promise<void> => { const previous = popup; popup = undefined; await previous?.close(); };
  const actions: MenuActions = {
    async invokeAction(actionUid) {
      try {
        await closePopup();
        await send({ type: "invoke", menuUid: state.view.uid, actionUid });
        renderer?.setActionError(actionUid);
      } catch (error) {
        renderer?.setActionError(actionUid, String(error));
        throw error;
      }
    },
    async requestToggleFold() { await closePopup(); await send({ type: "fold", menuUid: state.view.uid }); },
    async requestTemporarySave({ uid }) {
      await closePopup();
      if (lifetime.signal.aborted) return;
      const result = await send({ type: "temporaryConfirm", menuUid: state.view.uid, uid });
      if (result !== "prompt" || lifetime.signal.aborted) return;
      const note = viewport.prompt(`${t("temporary.confirmTitle")}\n${t("temporary.noteLabel")}`, "");
      if (note !== null && !lifetime.signal.aborted) await send({ type: "temporarySave", menuUid: state.view.uid, uid, note: note.trim() });
    },
  };
  function releaseEdit(): void {
    const token = editToken; editToken = undefined;
    if (token) report(send({ type: "editEnd", menuUid: state.view.uid, token }).then(() => {}));
  }
  async function customize(): Promise<void> {
    if (state.editingLocked || state.collapsed || editor || startingEdit) return;
    startingEdit = true;
    try {
      await closePopup();
      if (lifetime.signal.aborted || state.editingLocked) return;
      const token = crypto.randomUUID();
      const accepted = await send({ type: "editBegin", menuUid: state.view.uid, token });
      if (accepted !== true) { wrapper.title = t("bar.editBusy"); return; }
      editToken = token;
      if (lifetime.signal.aborted || state.editingLocked) { releaseEdit(); return; }
      renderer?.destroy(); renderer = undefined;
      Object.assign(wrapper.style, { right: "", bottom: "" });
      editor = mountBrowserCustomization(wrapper, root, barState(), state.placement,
        async (placement, spacing, settings) => {
          await send({ type: "layout", token, settings, menuUid: state.view.uid, placement, spacing });
          if (lifetime.signal.aborted) return;
          state = { ...state, placement, view: { ...state.view, ...settings, ...spacing } };
          finishCustomization();
        }, finishCustomization,
      );
      wrapper.removeAttribute("title");
    } catch (error) { releaseEdit(); throw error; }
    finally { startingEdit = false; }
  }
  function finishCustomization(): void {
    editor?.destroy(); editor = undefined; releaseEdit();
    root.removeAttribute("title"); delete root.dataset.error;
    layout(); mountRenderer();
  }
  const barState = () => ({ menu: state.view, itemSize: { width: state.placement.itemWidth, height: state.placement.itemHeight }, collapsed: state.collapsed, editingLocked: state.editingLocked, fontFamily: resolveFontFamily(state.view.fontFamily, "sans-serif") });
  let renderer: ReturnType<typeof mountBar> | undefined;
  function mountRenderer(): void {
    renderer = mountBar(root, barState(), {
      ...actions, requestCustomize: customize,
      waitForFonts: () => doc.fonts.load(`13px ${resolveFontFamily(state.view.fontFamily, "sans-serif")}`),
      async openPopup(request, pointerInside, pinned) {
        await closePopup();
        const opened = await openBrowserPopup(container, root, state.placement.anchor, request, actions, lifetime.signal, pointerInside, pinned);
        popup = opened;
        void opened.closed.then(() => { if (popup === opened) popup = undefined; });
        return opened;
      },
    });
    report(renderer.ready.then(() => { if (!lifetime.signal.aborted) wrapper.style.visibility = "visible"; }));
  }
  function dimensions() {
    const size = { width: state.placement.itemWidth, height: state.placement.itemHeight };
    return barSurfaceDimensions(state.view, size, state.collapsed);
  }
  function layout(): void {
    const size = dimensions();
    Object.assign(root.style, { flex: `0 0 ${size.width}px`, width: `${size.width}px`, height: `${size.height}px` });
    const fullSize = barSurfaceDimensions(state.view, { width: state.placement.itemWidth, height: state.placement.itemHeight });
    const toggle = state.collapsed ? barToggleOffset(state.view, { width: state.placement.itemWidth, height: state.placement.itemHeight }) : { x: 0, y: 0 };
    Object.assign(wrapper.style, placementStyle(state.placement, fullSize, size, toggle));
  }
  // Placement is pure CSS, so the browser keeps the bar in place through resizes and mobile toolbar
  // animations. A popup is laid out for the width it opened in, so only a width change closes it.
  let openWidth = container.clientWidth;
  viewport.addEventListener("resize", () => {
    if (container.clientWidth !== openWidth) { openWidth = container.clientWidth; report(closePopup()); }
    editor?.resize();
  }, { signal: lifetime.signal });
  layout(); mountRenderer();
  return {
    async update(next: BrowserMenu): Promise<void> {
      if (lifetime.signal.aborted || JSON.stringify(next) === JSON.stringify(state)) return;
      await closePopup();
      if (lifetime.signal.aborted) return;
      state = next;
      if (editor) {
        if (next.editingLocked || next.collapsed) finishCustomization();
        return;
      }
      layout(); await renderer?.update(barState());
    },
    destroy(): void {
      lifetime.abort(); releaseEdit(); void closePopup(); editor?.destroy(); renderer?.destroy(); wrapper.remove();
    },
  };
}
