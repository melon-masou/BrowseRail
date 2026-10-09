// Updates matching rule/rewrite bookmarks on active-tab URL changes.
import { matchesUrlRule } from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  type DynamicValue,
  loadConfig,
  loadDynamicValue,
  saveDynamicValue,
  normalizeDynamicBookmarks,
  normalizeUrlRules,
} from "../../lib/config";
import { evaluateDynamicBookmark, type DynamicUpdate } from "./evaluate";
import { DYNAMIC_TEST } from "./messages";

const MARKER_HOST = "browserail.local";
const DYNAMIC_FRAGMENT_PREFIX = "Dynamic:";
const DEBOUNCE_MS = 200;

// Ignore repeated notifications for the same tab URL.
const lastVisitUrlByTab = new Map<number, string>();
// Per-bookmark debounce timers.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function initDynamicBookmarks(requestSync: () => void): void {
  browser.runtime.onMessage.addListener((message: unknown, sender: browser.Runtime.MessageSender) => {
    // The options page opens in a tab, so check that the sender is an extension page
    // rather than rejecting every sender with a tab (which also covers content scripts).
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(""))) return;
    if (typeof message === "object" && message !== null && "type" in message && message.type === DYNAMIC_TEST) {
      const data = message as { bookmark?: unknown; rule?: unknown; url?: unknown };
      const bookmark = normalizeDynamicBookmarks([data.bookmark])[0];
      if (!bookmark || typeof data.url !== "string") return Promise.resolve({ ok: false, error: "Invalid test input" });
      const rule = normalizeUrlRules([data.rule])[0];
      return evaluateDynamicBookmark(bookmark, rule, data.url, "");
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
  // Marker interception also handles inactive tabs.
  if (await maybeInterceptMarker(tabId, url)) return;

  // Automatic updates require an active tab showing a web page.
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
    if (db.type === "external") continue;
    const rule = db.urlRuleUid ? ruleMap.get(db.urlRuleUid) : undefined;
    if (!rule || !matchesUrlRule(url, rule)) continue;
    scheduleRun(db.uid, url, title, requestSync);
  }
}

function scheduleRun(
  uid: string,
  url: string,
  title: string,
  requestSync: () => void,
): void {
  const prev = debounceTimers.get(uid);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    uid,
    setTimeout(() => {
      debounceTimers.delete(uid);
      void executeOne(uid, url, title, requestSync);
    }, DEBOUNCE_MS),
  );
}

async function executeOne(
  uid: string,
  url: string,
  title: string,
  requestSync: () => void,
): Promise<void> {
  const config = await loadConfig();
  const db = config.dynamicBookmarks.find(bookmark => bookmark.uid === uid);
  // A pending visit must not overwrite a bookmark switched to external updates.
  if (!db || db.type === "external") return;
  const rule = config.urlRules.find(rule => rule.uid === db.urlRuleUid);
  if (!rule) return;
  const current = await loadDynamicValue(db.uid);
  const result = await evaluateDynamicBookmark(db, rule, url, title);
  if (!result.ok || !("value" in result)) return;
  const { newUrl, title: newTitle } = result.value as DynamicUpdate;

  const next: DynamicValue = {
    ...current,
    url: newUrl,
    title: newTitle ?? title,
    updatedAt: Date.now(),
  };
  if (current?.url === next.url && current?.title === next.title) {
    return; // no change; avoid a needless sync
  }
  await saveDynamicValue(db.uid, next);
  requestSync();
}
