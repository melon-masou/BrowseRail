import { invertTemporaryActionUid, parseTemporaryAction, type BookmarkEntry } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import { invoke } from "@tauri-apps/api/core";

const HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 8;

interface TemporaryBookmarkContext {
  instanceUid: string;
  menuUid: string;
  windowUid: string | null;
}

export function attachTemporaryBookmarkButton(
  button: HTMLButtonElement,
  entry: BookmarkEntry,
  dispatchAction: (actionUid: string) => void,
  context: TemporaryBookmarkContext,
  onShortPress: () => void = () => dispatchAction(entry.uid),
  canAlternate: () => boolean = () => true,
): void {
  const { uid } = parseTemporaryAction(entry.uid);
  button.title = `${entry.label}\n${t("temporary.saveHint")}`;
  button.style.touchAction = "none";
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let holdingPointer: number | undefined;
  let startX = 0;
  let startY = 0;
  let held = false;

  const cancelHold = (): void => {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.button === 2) {
      if (!canAlternate()) return;
      event.preventDefault();
      event.stopPropagation();
      dispatchAction(invertTemporaryActionUid(entry.uid));
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture(event.pointerId);
    holdingPointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    held = false;
    cancelHold();
    holdTimer = setTimeout(() => {
      holdTimer = undefined;
      held = true;
      void invoke("open_temporary_confirmation", { ...context, uid, label: entry.label }).catch((error: unknown) => {
        console.error("Temporary bookmark dialog failed", error);
      });
    }, HOLD_MS);
  });

  button.addEventListener("pointermove", (event) => {
    if (event.pointerId !== holdingPointer) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) {
      cancelHold();
    }
  });

  button.addEventListener("pointerup", (event) => {
    if (event.pointerId !== holdingPointer) return;
    holdingPointer = undefined;
    const shouldNavigate = holdTimer !== undefined && !held;
    cancelHold();
    if (shouldNavigate && button.contains(document.elementFromPoint(event.clientX, event.clientY))) {
      onShortPress();
    }
  });
  button.addEventListener("pointercancel", () => {
    holdingPointer = undefined;
    cancelHold();
  });
  button.addEventListener("click", (event) => {
    if (event.detail === 0) onShortPress();
  });
}
