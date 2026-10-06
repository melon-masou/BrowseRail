import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, saveConfig, loadDynamicValues, saveDynamicValue } from "../config";

const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  storageDelayMs: 0,
  updated: undefined as ((id: number, change: { url?: string; status?: "loading" | "complete" }, tab: { active: boolean; title: string; url?: string }) => void) | undefined,
  rewrite: vi.fn(),
  message: undefined as ((message: unknown, sender: { id?: string; url?: string; tab?: object }) => unknown) | undefined,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: { local: {
    get: async (keys: string | string[]) => {
      const snapshot = structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, mock.storage[key]])));
      if (mock.storageDelayMs) await new Promise(resolve => setTimeout(resolve, mock.storageDelayMs));
      return snapshot;
    },
    set: async (values: Record<string, unknown>) => { Object.assign(mock.storage, values); },
  } },
  runtime: {
    id: "test-extension",
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener: (listener: typeof mock.message) => { mock.message = listener; } },
  },
  tabs: {
    onUpdated: { addListener: (listener: typeof mock.updated) => { mock.updated = listener; } },
    onRemoved: { addListener: vi.fn() },
  },
} }));
vi.mock("../dynamic/runner", async () => {
  const { applyRewrite } = await import("../dynamic/rewrite");
  return {
    runRewrite: mock.rewrite.mockImplementation(async (source: string, url: string) => applyRewrite(source, url)),
  };
});

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); mock.storage = {}; mock.storageDelayMs = 0; mock.rewrite.mockClear();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function start() {
  const { initDynamicBookmarks } = await import("./dynamic");
  initDynamicBookmarks(vi.fn());
}
async function visit(url: string) {
  mock.updated!(7, { url }, { active: true, title: "Visited page" });
  await vi.advanceTimersByTimeAsync(1_000);
}
async function definitions(uids = ["one"]) {
  const config = await loadConfig();
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com"] }];
  config.dynamicBookmarks = uids.map(uid => ({ uid, name: uid, type: "rule", urlRuleUid: "site" }));
  await saveConfig(config);
}

it("updates on URL changes while ignoring load events and same-URL reloads", async () => {
  await definitions();
  const config = await loadConfig();
  config.dynamicBookmarks[0]!.type = "rewrite";
  config.dynamicBookmarks[0]!.rewrite = 'replace "/article/" "/reader/"';
  await saveConfig(config);
  await start();
  const url = "https://example.com/article/123";
  const tab = { active: true, title: "Visited page", url };
  await visit(url);
  expect((await loadDynamicValues()).one?.url).toBe("https://example.com/reader/123");
  const runs = mock.rewrite.mock.calls.length;
  for (let event = 0; event < 4; event++) {
    mock.updated!(7, { status: "loading" }, tab);
    await vi.advanceTimersByTimeAsync(1000);
  }
  mock.updated!(7, { status: "complete" }, tab);
  await visit(url);
  expect(mock.rewrite).toHaveBeenCalledTimes(runs);
  await visit("https://example.com/article/456");
  expect((await loadDynamicValues()).one?.url).toBe("https://example.com/reader/456");
});

it("updates rule bookmarks without overwriting external bookmarks or accepting excluded visits", async () => {
  const config = await loadConfig();
  config.urlRules = [{ uid: "docs", name: "Docs", patterns: ["# notes", "example.com", "!https://example.com/private"] }];
  config.dynamicBookmarks = [
    { uid: "rule", name: "Rule", type: "rule", urlRuleUid: "docs" },
    { uid: "external", name: "External", type: "external", urlRuleUid: "docs" },
    { uid: "missing", name: "Missing rule", type: "rule", urlRuleUid: "deleted" },
  ];
  await saveConfig(config);
  await saveDynamicValue("external", { url: "https://example.com/saved", note: "context", updatedAt: 1 });
  await start(); await visit("https://example.com/docs");
  const values = await loadDynamicValues();
  expect(values.rule).toMatchObject({ url: "https://example.com/docs", title: "Visited page" });
  expect(values.external).toMatchObject({ url: "https://example.com/saved", note: "context", updatedAt: 1 });
  expect(values.missing).toBeUndefined();
  await visit("https://example.com/private");
  expect((await loadDynamicValues()).rule).toEqual(values.rule);
  await visit("https://other.com/docs");
  expect((await loadDynamicValues()).rule).toEqual(values.rule);
});

it("never runs a dynamic bookmark that is not bound to a URL rule", async () => {
  const config = await loadConfig();
  config.urlRules = [{ uid: "docs", name: "Docs", patterns: ["example.com"] }];
  config.dynamicBookmarks = [
    { uid: "external", name: "External", type: "external" },
    { uid: "rule", name: "Rule", type: "rule" },
  ];
  await saveConfig(config);
  await start(); await visit("https://example.com/docs");
  expect(await loadDynamicValues()).toEqual({});
});

it("does not apply a pending automatic visit after switching the bookmark to external updates", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/external", updatedAt: 1 });
  await start();
  mock.updated!(7, { url: "https://example.com/automatic" }, { active: true, title: "Visited page" });
  await vi.advanceTimersByTimeAsync(50);
  const config = await loadConfig();
  config.dynamicBookmarks[0]!.type = "external";
  await saveConfig(config);
  await vi.advanceTimersByTimeAsync(1000);
  expect((await loadDynamicValues()).one).toEqual({ url: "https://example.com/external", updatedAt: 1 });
});

it("updates rewrite bookmarks and preserves saved values when filtered or outside the rule", async () => {
  const { DEFAULT_REWRITE, REWRITE_EXAMPLE_URL } = await import("../dynamic/rewrite");
  const config = await loadConfig();
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com"] }];
  config.dynamicBookmarks = [{ uid: "rewritten", name: "Rewritten", type: "rewrite", urlRuleUid: "site", rewrite: DEFAULT_REWRITE }];
  await saveConfig(config);
  await start(); await visit(REWRITE_EXAMPLE_URL);
  const saved = (await loadDynamicValues()).rewritten;
  expect(saved?.url).toBe("https://example.com/reader/123");
  await visit("https://example.com/private");
  expect((await loadDynamicValues()).rewritten).toEqual(saved);
  config.dynamicBookmarks[0]!.rewrite = 'replace "example.com" "collector.test"';
  await saveConfig(config);
  await visit("https://example.com/article/456");
  expect((await loadDynamicValues()).rewritten).toEqual(saved);
});

it("tests draft rewrites without changing saved values, and denies website requests", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/saved", title: "Saved", updatedAt: 1 });
  await start();
  const config = await loadConfig();
  const request = { type: "testDynamicBookmark", bookmark: { ...config.dynamicBookmarks[0], type: "rewrite", rewrite: 'replace "/visit" "/test"' }, rule: config.urlRules[0], url: "https://example.com/visit" };
  expect(await mock.message!(request, { id: "test-extension", url: "https://example.com/", tab: {} })).toBeUndefined();
  const result = await mock.message!(request, { id: "test-extension", url: "chrome-extension://test-extension/options.html", tab: {} });
  expect(result).toEqual({ ok: true, value: { newUrl: "https://example.com/test", title: "" } });
  expect((await loadDynamicValues()).one).toEqual({ url: "https://example.com/saved", title: "Saved", updatedAt: 1 });
  expect((await loadConfig()).dynamicBookmarks[0]!.type).toBe("rule");
});

it("keeps both rule and rewrite results when the same visit updates multiple bookmarks", async () => {
  const { DEFAULT_REWRITE, REWRITE_EXAMPLE_URL } = await import("../dynamic/rewrite");
  await definitions(["rule"]);
  const config = await loadConfig();
  config.dynamicBookmarks.push({ uid: "rewrite", name: "Rewrite", type: "rewrite", urlRuleUid: "site", rewrite: DEFAULT_REWRITE });
  await saveConfig(config);
  await start();
  mock.storageDelayMs = 5;
  await visit(REWRITE_EXAMPLE_URL);
  mock.storageDelayMs = 0;
  const values = await loadDynamicValues();
  expect(values.rule?.url).toBe(REWRITE_EXAMPLE_URL);
  expect(values.rewrite?.url).toBe("https://example.com/reader/123");
});
