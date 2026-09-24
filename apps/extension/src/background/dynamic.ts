// Dynamic bookmark runtime (background side):
//  - intercepts native navigations to browserail.local markers and redirects
//    them (Dynamic:<id> → the live URL; anything else → the options page),
//  - on active-tab page visits, runs each matching dynamic bookmark's function
//    in the sandbox and persists the returned live URL/title.

import { isUrlMatchingSet } from "@browserail/protocol";
import browser from "webextension-polyfill";

import {
  type DynamicBookmark,
  type DynamicValue,
  loadConfig,
  loadDynamicValues,
  saveDynamicValue,
} from "../config";
import { runDynamic } from "../sandbox/runner";

const MARKER_HOST = "browserail.local";
const DYNAMIC_FRAGMENT_PREFIX = "Dynamic:";
const DEBOUNCE_MS = 200;
const TIMEOUT_MS = 200;

// Last committed URL per tab, to dedup onUpdated (it fires repeatedly per load).
const lastVisitUrlByTab = new Map<number, string>();
// Per-bookmark debounce timers.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function initDynamicBookmarks(requestSync: () => void): void {
  browser.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url;
    if (typeof url !== "string" || !url) return;
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

  // 2) Function trigger: active tab, real web page, deduped per (tabId, url).
  if (!active) return;
  if (!/^https?:\/\//i.test(url)) return;
  if (lastVisitUrlByTab.get(tabId) === url) return;
  lastVisitUrlByTab.set(tabId, url);
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
    const values = await loadDynamicValues();
    const live = values[id];
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
  if (dynamicBookmarks.length === 0) return;
  const ruleMap = new Map(config.urlRules.map((rule) => [rule.uid, rule]));

  for (const db of dynamicBookmarks) {
    if (!db.code.trim()) continue;
    if (db.urlRuleUids && db.urlRuleUids.length > 0) {
      const patterns = db.urlRuleUids.flatMap((uid) => ruleMap.get(uid)?.patterns ?? []);
      if (!isUrlMatchingSet(url, patterns)) continue;
    }
    scheduleRun(db, url, title, requestSync);
  }
}

function scheduleRun(
  db: DynamicBookmark,
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
      void executeOne(db, url, title, requestSync);
    }, DEBOUNCE_MS),
  );
}

async function executeOne(
  db: DynamicBookmark,
  url: string,
  title: string,
  requestSync: () => void,
): Promise<void> {
  const values = await loadDynamicValues();
  const current = values[db.uid];
  const args = {
    action: "visit" as const,
    url,
    title,
    current: { url: current?.url ?? null, title: current?.title ?? null },
  };

  const result = await runDynamic(db.code, args, TIMEOUT_MS);
  if (!result.ok || !result.value || typeof result.value !== "object") return;

  const value = result.value as { newUrl?: unknown; title?: unknown };
  const newUrl = typeof value.newUrl === "string" ? value.newUrl : null;
  // Only accept an http(s) URL; ignore anything else (javascript:, junk, null).
  if (!newUrl || !/^https?:\/\//i.test(newUrl)) return;
  const newTitle = typeof value.title === "string" && value.title ? value.title : title;

  const next: DynamicValue = { url: newUrl, title: newTitle, updatedAt: Date.now() };
  if (current && current.url === next.url && current.title === next.title) {
    return; // no change; avoid a needless sync
  }
  await saveDynamicValue(db.uid, next);
  requestSync();
}
