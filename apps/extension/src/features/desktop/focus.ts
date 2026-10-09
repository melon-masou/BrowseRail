import type { BrowserWindowCandidate } from "../../lib/browser/windows";

/** The browser window the user last focused; desktop invokes and shortcuts without a window target use it. */
export function createWindowFocus() {
  let lastFocusedWindowUid: string | undefined;
  return {
    get(): string | undefined { return lastFocusedWindowUid; },
    set(windowUid: string): void { lastFocusedWindowUid = windowUid; },
    /** Follows the focused window in a fresh window list, or any remaining window when focus left the browser. */
    updateFrom(windows: readonly BrowserWindowCandidate[]): void {
      const focused = windows.find((window) => window.focused);
      if (focused) {
        lastFocusedWindowUid = focused.uid;
      } else if (!windows.some((window) => window.uid === lastFocusedWindowUid)) {
        lastFocusedWindowUid = windows[0]?.uid;
      }
    },
  };
}
export type WindowFocus = ReturnType<typeof createWindowFocus>;
