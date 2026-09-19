import type {
  BrowserKind,
  BrowserWindowSnapshot,
} from "@browserail/protocol";
import browser from "webextension-polyfill";

export type BrowserWindowCandidate = BrowserWindowSnapshot & {
  focused: boolean;
  activeTabUrl?: string;
};

export function browserKind(): BrowserKind {
  if (browser.runtime.getURL("").startsWith("moz-extension:")) {
    return "firefox";
  }

  const userAgent = navigator.userAgent;
  if (/\bEdg\//.test(userAgent)) {
    return "edge";
  }
  if (/\bOPR\//.test(userAgent)) {
    return "opera";
  }
  if (/\bVivaldi\//.test(userAgent)) {
    return "vivaldi";
  }
  if (
    "brave" in navigator &&
    typeof (navigator as Navigator & { brave?: unknown }).brave === "object"
  ) {
    return "brave";
  }
  return "chrome";
}

export async function listBrowserWindows(): Promise<BrowserWindowCandidate[]> {
  const windows = await browser.windows.getAll({ windowTypes: ["normal"], populate: true });

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

    const activeTab = window.tabs?.find((tab) => tab.active);
    const activeTabUrl = activeTab?.url;

    return [
      {
        uid: String(window.id),
        focused: window.focused ?? false,
        activeTabUrl,
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
