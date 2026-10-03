import { t } from "@browserail/i18n";
import { mountBar, barDimensions, type MenuActions, type PopupSession } from "@browserail/menu-ui";
import type { BrowserMenu, MenuRequest, TemporaryConfirmationResult } from "./messages";
import { openBrowserPopup } from "./popup";
import { mountBrowserCustomization } from "./customization";
import { placementPoint } from "./placement";

export type MenuCommand = MenuRequest;
const FONT = 'Segoe UI, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export function mountBrowserMenu(container: HTMLElement, initial: BrowserMenu, send: (command: MenuCommand) => Promise<TemporaryConfirmationResult | undefined>) {
  const doc = container.ownerDocument;
  const viewport = doc.defaultView!;
  const lifetime = new AbortController();
  const wrapper = doc.createElement("div"); wrapper.className = "browser-bar"; wrapper.style.visibility = "hidden";
  const root = doc.createElement("div");
  wrapper.append(root); container.append(wrapper);
  let state = initial;
  let popup: PopupSession | undefined;
  let editor: ReturnType<typeof mountBrowserCustomization> | undefined;
  const report = (action: Promise<void>): void => {
    void action.catch(error => { if (!lifetime.signal.aborted) { wrapper.title = String(error); root.dataset.error = ""; } });
  };
  const closePopup = async (): Promise<void> => { const previous = popup; popup = undefined; await previous?.close(); };
  const actions: MenuActions = {
    async invokeAction(actionUid) { await closePopup(); await send({ type: "invoke", menuUid: state.view.uid, actionUid }); },
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
  async function customize(): Promise<void> {
    if (state.editingLocked || state.collapsed || editor) return;
    await closePopup();
    if (lifetime.signal.aborted || state.editingLocked || editor) return;
    renderer?.destroy(); renderer = undefined;
    editor = mountBrowserCustomization(wrapper, root, barState(), state.placement,
      async placement => {
        await send({ type: "placement", menuUid: state.view.uid, placement });
        if (lifetime.signal.aborted) return;
        state = { ...state, placement };
        finishCustomization();
      }, finishCustomization,
    );
  }
  function finishCustomization(): void {
    editor?.destroy(); editor = undefined;
    root.removeAttribute("title"); delete root.dataset.error;
    layout(); mountRenderer();
  }
  const barState = () => ({ menu: state.view, itemSize: { width: state.placement.itemWidth, height: state.placement.itemHeight }, collapsed: state.collapsed, editingLocked: state.editingLocked, fontFamily: FONT });
  let renderer: ReturnType<typeof mountBar> | undefined;
  function mountRenderer(): void {
    renderer = mountBar(root, barState(), {
      ...actions, requestCustomize: customize,
      waitForFonts: () => doc.fonts.load(`13px ${FONT}`),
      async openPopup(request) {
        await closePopup();
        const opened = await openBrowserPopup(container, request, actions, lifetime.signal);
        popup = opened;
        void opened.closed.then(() => { if (popup === opened) popup = undefined; });
        return opened;
      },
    });
    report(renderer.ready.then(() => { if (!lifetime.signal.aborted) wrapper.style.visibility = "visible"; }));
  }
  function dimensions() {
    const size = { width: state.placement.itemWidth, height: state.placement.itemHeight };
    return state.collapsed ? size : barDimensions(state.view, size);
  }
  function layout(): void {
    const size = dimensions();
    Object.assign(root.style, { flex: `0 0 ${size.width}px`, width: `${size.width}px`, height: `${size.height}px` });
    const fullSize = barDimensions(state.view, { width: state.placement.itemWidth, height: state.placement.itemHeight });
    const position = placementPoint(state.placement, fullSize.width, fullSize.height, viewport.innerWidth, viewport.innerHeight);
    if (state.collapsed) {
      let units = 0;
      for (const entry of state.view.items) {
        if (entry.kind === "menuFold") break;
        units += entry.kind === "space" ? Math.max(0.1, entry.units ?? 1) : 1;
      }
      const track = Math.round(units);
      const gap = state.view.gap ?? 4;
      if (state.view.orientation === "row") position.x += track * (state.placement.itemWidth + gap);
      else position.y += track * (state.placement.itemHeight + gap);
    }
    wrapper.style.left = `${position.x}px`; wrapper.style.top = `${position.y}px`;
  }
  viewport.addEventListener("resize", () => {
    report(closePopup()); if (editor) editor.resize(); else layout();
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
      lifetime.abort(); void closePopup(); editor?.destroy(); renderer?.destroy(); wrapper.remove();
    },
  };
}
