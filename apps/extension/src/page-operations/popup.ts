import {
  mountFolderPopup, createLifetime, createTextMeasure, planFolderPopup,
  type MenuActions, type PopupRequest, type PopupSession,
} from "@browserail/menu-ui";

export async function openBrowserPopup(container: HTMLElement, request: PopupRequest, actions: MenuActions, signal: AbortSignal): Promise<PopupSession> {
  if (signal.aborted) throw new Error("Menu was removed");
  const doc = container.ownerDocument;
  const root = doc.createElement("div");
  root.className = "browser-popup browserail-menu-ui";
  root.style.visibility = "hidden";
  root.style.setProperty("--menu-font-family", request.theme.fontFamily);
  container.append(root);
  const waitForFonts = () => doc.fonts.load(`${request.theme.fontSize}px ${request.theme.fontFamily}`);
  const lifetime = createLifetime(root, waitForFonts);
  const measure = createTextMeasure(root, lifetime);
  let renderer: ReturnType<typeof mountFolderPopup> | undefined;
  let done!: () => void;
  const closed = new Promise<void>(resolve => { done = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let barInside = true;
  let popupInside = false;
  const cancelClose = (): void => { clearTimeout(timer); };
  const close = async (): Promise<void> => {
    if (!lifetime.alive) return;
    cancelClose(); lifetime.destroy(); renderer?.destroy(); root.remove();
    signal.removeEventListener("abort", abort);
    done();
  };
  const abort = (): void => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  const schedule = (): void => {
    cancelClose();
    if (!barInside && !popupInside) timer = setTimeout(() => { void close(); }, 80);
  };
  const session: PopupSession = {
    closed, close, cancelClose,
    requestClose: schedule,
    setBarPointerInside(inside) { barInside = inside; schedule(); },
  };
  try {
    await lifetime.settle();
    if (!lifetime.alive) return session;
    const viewport = doc.compatMode === "CSS1Compat" ? doc.documentElement : doc.body;
    const { surface, state } = planFolderPopup(measure, request, { left: 0, top: 0, right: viewport.clientWidth, bottom: viewport.clientHeight });
    Object.assign(root.style, {
      left: `${surface.left}px`, top: `${surface.top}px`,
      width: `${surface.right - surface.left}px`, height: `${surface.bottom - surface.top}px`,
    });
    renderer = mountFolderPopup(root, state, {
      ...actions, close, waitForFonts,
      setPointerInside(inside) { popupInside = inside; schedule(); },
      async commitLayout() {},
    });
    await renderer.ready;
    if (lifetime.alive) root.style.visibility = "visible";
    return session;
  } catch (error) { await close(); throw error; }
}
