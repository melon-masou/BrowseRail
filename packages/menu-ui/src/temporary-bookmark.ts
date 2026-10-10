import { invertTemporaryActionUid, parseTemporaryAction, type BookmarkEntry } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import type { MenuActions } from "./types";

import { HOLD_MS, MOVE_TOLERANCE_PX } from "./press";

export function attachTemporaryBookmarkButton(
  button: HTMLButtonElement,
  entry: BookmarkEntry,
  host: Pick<MenuActions, "invokeAction" | "requestTemporarySave">,
  interaction: { onShortPress(): void; canAlternate(): boolean },
): () => void {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const { uid } = parseTemporaryAction(entry.uid);
  button.title = `${entry.label}\n${t("temporary.saveHint")}`;
  button.style.touchAction = "none";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | undefined;
  let startX = 0;
  let startY = 0;
  let held = false;
  const cancelHold = (): void => { clearTimeout(timer); timer = undefined; };
  const run = (action: Promise<void>): void => {
    void action.catch(error => { if (!abort.signal.aborted) { button.title = String(error); button.dataset.error = ""; } });
  };
  button.addEventListener("pointerdown", event => {
    if (event.button === 2) {
      if (!interaction.canAlternate()) return;
      event.preventDefault();
      event.stopPropagation();
      run(host.invokeAction(invertTemporaryActionUid(entry.uid)));
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture(event.pointerId);
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    held = false;
    cancelHold();
    timer = setTimeout(() => {
      timer = undefined;
      held = true;
      run(host.requestTemporarySave({ uid, label: entry.label }));
    }, HOLD_MS);
  }, options);
  button.addEventListener("pointermove", event => {
    if (event.pointerId !== pointer) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) cancelHold();
  }, options);
  button.addEventListener("pointerup", event => {
    if (event.pointerId !== pointer) return;
    pointer = undefined;
    const navigate = timer !== undefined && !held;
    cancelHold();
    if (navigate) {
      const tree = button.getRootNode() as Document | ShadowRoot;
      if (button.contains(tree.elementFromPoint(event.clientX, event.clientY))) interaction.onShortPress();
    }
  }, options);
  button.addEventListener("pointercancel", () => { pointer = undefined; cancelHold(); }, options);
  button.addEventListener("lostpointercapture", () => { pointer = undefined; cancelHold(); }, options);
  button.addEventListener("click", event => { if (event.detail === 0) interaction.onShortPress(); }, options);
  return () => {
    abort.abort();
    cancelHold();
    if (pointer !== undefined && button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
    pointer = undefined;
  };
}
