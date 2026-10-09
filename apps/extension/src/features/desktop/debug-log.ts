import browser from "webextension-polyfill";

export interface ExtensionDebugLogEntry {
  time: string;
  tag: string;
  message: string;
  details?: unknown;
}

const MAX_DEBUG_LOGS = 250;

/** Debug logging toggled from the options page; entries are also forwarded to the desktop when connected. */
export function createDebugLog() {
  let enabled = false;
  const entries: ExtensionDebugLogEntry[] = [];
  let forward: ((entry: ExtensionDebugLogEntry) => void) | undefined;

  function log(tag: string, message: string, details?: unknown): void {
    if (!enabled) return;
    const entry: ExtensionDebugLogEntry = { time: new Date().toISOString(), tag, message, details };
    entries.push(entry);
    if (entries.length > MAX_DEBUG_LOGS) entries.shift();
    console.log(`[BrowseRail][${tag}] ${message}`, details !== undefined ? details : "");
    forward?.(entry);
  }

  function apply(next: boolean): void {
    enabled = next;
    if (!enabled) entries.length = 0;
    else log("Debug", "Debug logging enabled");
  }

  void browser.storage.local
    .get("debugLoggingEnabled")
    .then((res) => { enabled = Boolean(res.debugLoggingEnabled); })
    .catch(() => {});
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.debugLoggingEnabled) apply(Boolean(changes.debugLoggingEnabled.newValue));
  });

  return {
    log,
    get enabled(): boolean { return enabled; },
    entries: entries as readonly ExtensionDebugLogEntry[],
    async setEnabled(next: boolean): Promise<{ ok: true; debugLoggingEnabled: boolean }> {
      apply(next);
      await browser.storage.local.set({ debugLoggingEnabled: next });
      return { ok: true, debugLoggingEnabled: enabled };
    },
    forwardTo(sink: (entry: ExtensionDebugLogEntry) => void): void { forward = sink; },
  };
}
export type DebugLog = ReturnType<typeof createDebugLog>;
