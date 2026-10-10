export const HOLD_MS = 500;
export const MOVE_TOLERANCE_PX = 8;

export interface PressHandlers {
  /** Checked on every press; when false the press is left to the surrounding element. */
  enabled(): boolean;
  primary(): void;
  /** Right button for a mouse; holding still for touch and pen. */
  alternate?(): void;
}

/**
 * A mouse acts on press, with the right button as the alternate. Touch and pen have no right button
 * and must not act before a scroll is ruled out, so they act on release and treat a hold as the alternate.
 */
export function attachPress(button: HTMLElement, handlers: PressHandlers, signal: AbortSignal): void {
  button.addEventListener("pointerdown", event => {
    if (!handlers.enabled()) return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      if (event.button === 0) { event.preventDefault(); handlers.primary(); }
      else if (event.button === 2 && handlers.alternate) { event.preventDefault(); event.stopPropagation(); handlers.alternate(); }
      return;
    }
    if (!event.isPrimary) return;
    event.preventDefault();
    const { pointerId, clientX, clientY } = event;
    let settled = false;
    const timer = handlers.alternate
      ? setTimeout(() => { settled = true; handlers.alternate!(); }, HOLD_MS)
      : undefined;
    const gesture = new AbortController();
    const finish = (): void => { clearTimeout(timer); gesture.abort(); };
    const options = { signal: AbortSignal.any([signal, gesture.signal]) };
    signal.addEventListener("abort", finish, { once: true, signal: gesture.signal });
    button.addEventListener("pointermove", next => {
      if (next.pointerId !== pointerId) return;
      if (Math.hypot(next.clientX - clientX, next.clientY - clientY) > MOVE_TOLERANCE_PX) { settled = true; finish(); }
    }, options);
    button.addEventListener("pointerup", next => {
      if (next.pointerId !== pointerId) return;
      finish();
      if (!settled) handlers.primary();
    }, options);
    button.addEventListener("pointercancel", next => { if (next.pointerId === pointerId) finish(); }, options);
  }, { signal });
}
