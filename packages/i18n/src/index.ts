// Shared runtime i18n for BrowseRail's DOM apps (extension options page and the
// desktop Tauri webviews).
//
// Language resolution: a stored dropdown choice wins; otherwise the webview/page
// language decides (zh* -> zh-CN, else en). English is the ultimate fallback for
// any missing key. The choice is stored in localStorage, which is available and
// persistent in both an extension page and the Tauri webview, and is resolved
// synchronously at import — so getLanguage()/t() are correct from first use.

import { en, zhCN, type MessageKey } from "./messages";

export { en, zhCN, type MessageKey } from "./messages";

export type Lang = "en" | "zh-CN";

export const LANGUAGES: readonly Lang[] = ["en", "zh-CN"];

const STORAGE_KEY = "browserail.uiLanguage";

const catalogs: Record<Lang, Record<MessageKey, string>> = {
  en,
  "zh-CN": zhCN,
};

/** Map a BCP-47-ish tag to a shipped locale: `zh*` -> zh-CN, everything else -> en. */
export function normalizeTag(tag: string): Lang {
  return tag.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** Best-effort detection from the page/webview language, ignoring any stored choice. */
export function detectLanguage(): Lang {
  let tag = "";
  try {
    tag = navigator.language ?? "";
  } catch {
    // navigator unavailable
  }
  return normalizeTag(tag);
}

function readStored(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") {
      return stored;
    }
  } catch {
    // localStorage blocked
  }
  return null;
}

let current: Lang = readStored() ?? detectLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Lang {
  return current;
}

/** Set the active language in memory and notify subscribers. Does not persist. */
export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Persist and activate an explicit language choice. */
export function saveLanguage(lang: Lang): void {
  setLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // localStorage blocked; in-memory language still updated
  }
}

/** Translate a key in the active language, substituting `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const table = catalogs[current] ?? en;
  let message = table[key] ?? en[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      message = message.split(`{${name}}`).join(String(value));
    }
  }
  return message;
}

function isMessageKey(key: string): key is MessageKey {
  return key in en;
}

/**
 * Localize static markup in the active language. Elements opt in via attributes:
 * `data-i18n` (textContent), `data-i18n-title`, `data-i18n-ph` (placeholder),
 * `data-i18n-aria` (aria-label). Safe to call repeatedly, e.g. on language change.
 */
export function applyStaticI18n(root: ParentNode = document): void {
  const assign = (attr: string, apply: (el: HTMLElement, text: string) => void): void => {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      if (key && isMessageKey(key)) {
        apply(el, t(key));
      }
    }
  };
  assign("data-i18n", (el, text) => {
    el.textContent = text;
  });
  assign("data-i18n-title", (el, text) => {
    el.title = text;
  });
  assign("data-i18n-ph", (el, text) => {
    (el as HTMLInputElement).placeholder = text;
  });
  assign("data-i18n-aria", (el, text) => {
    el.setAttribute("aria-label", text);
  });
}
