import {
  mountFolderPopup, createLifetime, createTextMeasure, popupEnvelope, calculateColumnWidth,
  type MenuActions, type PopupRequest, type PopupSession,
} from "@browserail/menu-ui";

export async function openBrowserPopup(container: HTMLElement, request: PopupRequest, actions: MenuActions, signal: AbortSignal): Promise<PopupSession> {
  if (signal.aborted) throw new Error("Menu was removed");
  const doc = container.ownerDocument;
  const viewport = doc.defaultView!;
  const root = doc.createElement("div");
  root.className = "browser-popup";
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
    const { anchor, theme } = request;
    let direction = request.direction;
    if (direction === "down" && viewport.innerHeight - anchor.bottom < Math.min(120, anchor.top)) direction = "up";
    else if (direction === "up" && anchor.top < Math.min(120, viewport.innerHeight - anchor.bottom)) direction = "down";
    const horizontal = direction === "left" || direction === "right";
    const maxColumnHeight = Math.max(48, (direction === "up" ? anchor.top : direction === "down" ? viewport.innerHeight - anchor.bottom : viewport.innerHeight - anchor.top) - 4);
    const envelope = popupEnvelope(measure, request.folder.children, theme.fontSize, theme.itemHeight, maxColumnHeight, direction);
    const columnWidth = calculateColumnWidth(measure, request.folder.children, theme.fontSize, maxColumnHeight, theme.itemHeight);
    let rootDirection = direction;
    let rootOffsetX = 0;
    let width = envelope.width;
    let x = Math.max(4, Math.min(anchor.left, viewport.innerWidth - width - 4));
    if (horizontal) {
      if ((direction === "left" ? anchor.left : viewport.innerWidth - anchor.right) < columnWidth) rootDirection = direction === "left" ? "right" : "left";
      rootOffsetX = Math.max(0, envelope.width - columnWidth);
      width = rootOffsetX * 2 + columnWidth;
      x = (rootDirection === "left" ? anchor.left - columnWidth : anchor.right) - rootOffsetX;
    }
    const y = direction === "up" ? anchor.top - envelope.height : direction === "down" ? anchor.bottom : anchor.top;
    Object.assign(root.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${envelope.height}px` });
    renderer = mountFolderPopup(root, {
      entries: request.folder.children, theme, direction, rootDirection, rootOffsetX,
      bounds: { left: 4, top: 4, right: viewport.innerWidth - 4, bottom: viewport.innerHeight - 4 },
      maxColumnHeight, editingLocked: request.editingLocked,
    }, {
      ...actions, close, waitForFonts,
      setPointerInside(inside) { popupInside = inside; schedule(); },
      async commitLayout() {},
    });
    await renderer.ready;
    if (lifetime.alive) root.style.visibility = "visible";
    return session;
  } catch (error) { await close(); throw error; }
}
