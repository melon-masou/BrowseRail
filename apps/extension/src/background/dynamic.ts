// Dynamic bookmark runtime (background side):
//  - intercepts native navigations to browserail.local markers and redirects
//    them (Dynamic:<id> → the live URL; anything else → the options page),
//  - on active-tab page visits, runs each matching dynamic bookmark's function
//    in a supported sandbox and persists the returned URL/title and script context.

import { matchesUrlRule } from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  type DynamicBookmark,
  type DynamicValue,
  type UrlRule,
  loadConfig,
  loadDynamicValue,
  saveDynamicValue,
  normalizeDynamicBookmarks,
  normalizeUrlRules,
} from "../config";
import { initializeSandbox } from "../dynamic/runner";
import { evaluateDynamicBookmark, type DynamicUpdate } from "../dynamic/evaluate";

const MARKER_HOST = "browserail.local";
const DYNAMIC_FRAGMENT_PREFIX = "Dynamic:";
const DEBOUNCE_MS = 200;

// Ignore repeated notifications for the same tab URL.
const lastVisitUrlByTab = new Map<number, string>();
// Per-bookmark debounce timers.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function initDynamicBookmarks(requestSync: () => void): void {
  void initializeSandbox();
  browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
    // The options page opens in a tab, so check that the sender is an extension page
    // rather than rejecting every sender with a tab (which also covers content scripts).
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(""))) return;
    if (typeof message === "object" && message !== null && "type" in message && message.type === "getDynamicSandboxStatus") return initializeSandbox();
    if (typeof message === "object" && message !== null && "type" in message && message.type === "testDynamicBookmark") {
      const data = message as { bookmark?: unknown; rule?: unknown; url?: unknown };
      const bookmark = normalizeDynamicBookmarks([data.bookmark])[0];
      if (!bookmark || typeof data.url !== "string") return Promise.resolve({ ok: false, error: "Invalid test input" });
      const rule = normalizeUrlRules([data.rule])[0];
      return loadDynamicValue(bookmark.uid).then(current => evaluateDynamicBookmark(bookmark, rule, data.url as string, "", current, true));
    }
  });
  browser.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url;
    if (typeof url !== "string" || !url) return;
    if (lastVisitUrlByTab.get(tabId) === url) return;
    lastVisitUrlByTab.set(tabId, url);
    void handleNavigation(tabId, url, Boolean(tab.active), tab.title ?? "", requestSync);
  });
  browser.tabs?.onRemoved?.addListener((tabId) => {
    lastVisitUrlByTab.delete(tabId);
  });
}

async function handleNavigation(
  tabId: number,
  url: string,
  active: boolean,
  title: string,
  requestSync: () => void,
): Promise<void> {
  // 1) browserail.local marker interception (any tab), preempts the function run.
  if (await maybeInterceptMarker(tabId, url)) return;

  // 2) Function trigger: active tab, real web page.
  if (!active) return;
  if (!/^https?:\/\//i.test(url)) return;
  await runVisit(url, title, requestSync);
}

async function maybeInterceptMarker(tabId: number, url: string): Promise<boolean> {
  let host: string;
  let fragment: string;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  } catch {
    return false;
  }
  if (host !== MARKER_HOST) return false;

  if (fragment.startsWith(DYNAMIC_FRAGMENT_PREFIX)) {
    const id = fragment.slice(DYNAMIC_FRAGMENT_PREFIX.length);
    const live = await loadDynamicValue(id);
    // No value yet → leave the tab as-is (do not redirect).
    if (live?.url) {
      try {
        await browser.tabs.update(tabId, { url: live.url });
      } catch {
        // tab gone; ignore
      }
    }
  } else {
    // Any other browserail.local bookmark (e.g. a Space marker) → the options page.
    try {
      await browser.tabs.update(tabId, { url: browser.runtime.getURL("options.html") });
    } catch {
      // ignore
    }
  }
  return true;
}

async function runVisit(url: string, title: string, requestSync: () => void): Promise<void> {
  const config = await loadConfig();
  const dynamicBookmarks = config.dynamicBookmarks ?? [];
  const ruleMap = new Map(config.urlRules.map((rule) => [rule.uid, rule]));

  for (const db of dynamicBookmarks) {
    const rule = db.urlRuleUid ? ruleMap.get(db.urlRuleUid) : undefined;
    if (!rule || !matchesUrlRule(url, rule)) continue;
    if (db.type === "code" && (!db.code.trim() || await initializeSandbox() !== "supported")) continue;
    scheduleRun(db, rule, url, title, requestSync);
  }
}

function scheduleRun(
  db: DynamicBookmark,
  rule: UrlRule,
  url: string,
  title: string,
  requestSync: () => void,
): void {
  const prev = debounceTimers.get(db.uid);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    db.uid,
    setTimeout(() => {
      debounceTimers.delete(db.uid);
      void executeOne(db, rule, url, title, requestSync);
    }, DEBOUNCE_MS),
  );
}

async function executeOne(
  db: DynamicBookmark,
  rule: UrlRule,
  url: string,
  title: string,
  requestSync: () => void,
): Promise<void> {
  const current = await loadDynamicValue(db.uid);
  const result = await evaluateDynamicBookmark(db, rule, url, title, current);
  if (!result.ok || !("value" in result)) return;
  const { newUrl, title: newTitle, note } = result.value as DynamicUpdate;

  const next: DynamicValue = {
    ...current,
    ...(newUrl !== null ? {
      url: newUrl,
      title: newTitle ?? title,
    } : {}),
    ...(typeof note === "string" ? { note } : {}),
    updatedAt: Date.now(),
  };
  if (current?.url === next.url && current?.title === next.title && current?.note === next.note) {
    return; // no change; avoid a needless sync
  }
  await saveDynamicValue(db.uid, next);
  requestSync();
}
