import type {
  BrowserKind,
  BrowserWindowSnapshot,
  BrowserWindowState,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

export function browserKind(): BrowserKind {
  return browser.runtime.getURL("").startsWith("moz-extension:") ? "firefox" : "chrome";
}

export async function listBrowserWindows(): Promise<BrowserWindowSnapshot[]> {
  const windows = await browser.windows.getAll({ windowTypes: ["normal"] });

  return windows.flatMap((window) => {
    if (
      window.id === undefined ||
      window.left === undefined ||
      window.top === undefined ||
      window.width === undefined ||
      window.height === undefined
    ) {
      return [];
    }

    return [
      {
        uid: String(window.id),
        focused: window.focused ?? false,
        state: normalizeWindowState(window.state),
        bounds: {
          x: window.left,
          y: window.top,
          width: window.width,
          height: window.height,
        },
      },
    ];
  });
}

function normalizeWindowState(state: browser.Windows.WindowState | undefined): BrowserWindowState {
  return state === "minimized" || state === "maximized" || state === "fullscreen"
    ? state
    : "normal";
}

