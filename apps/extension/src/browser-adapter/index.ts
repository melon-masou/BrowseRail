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
  const [windows, activeTabs] = await Promise.all([
    browser.windows.getAll({ windowTypes: ["normal"], populate: true }),
    browser.tabs.query({ active: true }).catch(() => []),
  ]);

  const activeTabMap = new Map<number, string>();
  for (const tab of activeTabs) {
    if (tab.windowId !== undefined) {
      const url = tab.url || (tab as { pendingUrl?: string }).pendingUrl;
      if (url) {
        activeTabMap.set(tab.windowId, url);
      }
    }
  }

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
    const activeTabUrl =
      (window.id !== undefined ? activeTabMap.get(window.id) : undefined) ||
      activeTab?.url ||
      (activeTab as { pendingUrl?: string } | undefined)?.pendingUrl;

    return [
      {
        uid: String(window.id),
        focused: window.focused ?? false,
        ...(activeTabUrl !== undefined ? { activeTabUrl } : {}),
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
