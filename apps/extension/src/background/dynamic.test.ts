import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, saveConfig, loadDynamicValues, saveDynamicValue } from "../config";

interface Context {
  action: "visit";
  url: string;
  title: string;
  current: { url: string | null; title: string | null; note: string };
}
const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  storageDelayMs: 0,
  updated: undefined as ((id: number, change: { url?: string; status?: "loading" | "complete" }, tab: { active: boolean; title: string; url?: string }) => void) | undefined,
  supported: vi.fn<() => Promise<"supported" | "unsupported" | "failed">>(),
  run: vi.fn<(code: string, context: Context) => Promise<{ ok: boolean; value?: unknown }>>(),
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
    runDynamic: mock.run,
    initializeSandbox: mock.supported,
    runRewrite: async (source: string, url: string) => applyRewrite(source, url),
  };
});

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); mock.storage = {}; mock.storageDelayMs = 0; mock.run.mockReset(); mock.supported.mockResolvedValue("supported");
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
  config.dynamicBookmarks = uids.map(uid => ({ uid, name: uid, type: "code", urlRuleUid: "site", code: "function dynamicBookmark() {}" }));
  await saveConfig(config);
}

it("updates once per URL change, ignoring repeated load events and same-URL reloads", async () => {
  await definitions();
  mock.run.mockImplementation(async (_code, context) => ({
    ok: true, value: { newUrl: null, note: String(Number(context.current.note || "0") + 1) },
  }));
  await start();
  const url = "https://example.com/page";
  const tab = { active: true, title: "Visited page", url };
  await visit(url);
  expect((await loadDynamicValues()).one?.note).toBe("1");
  for (let event = 0; event < 4; event++) {
    mock.updated!(7, { status: "loading" }, tab);
    await vi.advanceTimersByTimeAsync(1_000);
  }
  mock.updated!(7, { status: "complete" }, tab);
  await visit(url);
  expect((await loadDynamicValues()).one?.note).toBe("1");
  await visit("https://example.com/other");
  expect((await loadDynamicValues()).one?.note).toBe("2");
  await visit(url);
  expect((await loadDynamicValues()).one?.note).toBe("3");
  await visit("chrome://newtab/");
  await visit(url);
  expect((await loadDynamicValues()).one?.note).toBe("4");
});

it("keeps each script's note across worker restarts, including before it has saved a URL", async () => {
  await definitions(["one", "two"]);
  await saveDynamicValue("two", { note: "10", updatedAt: Date.now() });
  mock.run.mockImplementation(async (_code, context) => ({
    ok: true, value: { newUrl: null, note: String(Number(context.current.note || "0") + 1) },
  }));
  await start(); await visit("https://example.com/first");
  expect(mock.run.mock.calls[0]![1].current).toEqual({ url: null, title: null, note: "" });
  let values = await loadDynamicValues();
  expect(values.one?.note).toBe("1"); expect(values.one?.url).toBeUndefined();
  expect(values.two?.note).toBe("11");
  vi.resetModules(); await start();
  await visit("https://example.com/first");
  values = await loadDynamicValues();
  expect(values.one?.note).toBe("2"); expect(values.two?.note).toBe("12");
});

it("updates context without changing the URL, preserves omitted notes, and clears an empty note", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/saved", title: "Saved", note: "old", updatedAt: Date.now() });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: null, note: "new" } });
  await start(); await visit("https://example.com/first");
  expect((await loadDynamicValues()).one).toMatchObject({ url: "https://example.com/saved", title: "Saved", note: "new" });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/updated", title: "Updated" } });
  await visit("https://example.com/second");
  expect((await loadDynamicValues()).one).toMatchObject({ url: "https://example.com/updated", title: "Updated", note: "new" });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: null, note: "" } });
  await visit("https://example.com/third");
  const cleared = (await loadDynamicValues()).one;
  expect(cleared).toMatchObject({ url: "https://example.com/updated", title: "Updated", note: "" });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: null } });
  await visit("https://example.com/fourth");
  expect((await loadDynamicValues()).one).toEqual(cleared);
});

it("ignores invalid notes and invalid URL results without overwriting saved context", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/saved", title: "Saved", note: "keep", updatedAt: Date.now() });
  await start();
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: null, note: { context: "invalid" } } });
  await visit("https://example.com/first");
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "javascript:alert(1)", note: "overwrite" } });
  await visit("https://example.com/second");
  expect((await loadDynamicValues()).one).toMatchObject({ url: "https://example.com/saved", title: "Saved", note: "keep" });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/updated", note: 42 } });
  await visit("https://example.com/third");
  expect((await loadDynamicValues()).one).toMatchObject({ url: "https://example.com/updated", note: "keep" });
});


it("updates rule bookmarks while skipping unsupported code and excluded visits", async () => {
  const config = await loadConfig();
  config.urlRules = [{ uid: "docs", name: "Docs", patterns: ["# notes", "example.com", "!https://example.com/private"] }];
  config.dynamicBookmarks = [
    { uid: "rule", name: "Rule", type: "rule", urlRuleUid: "docs", code: "" },
    { uid: "script", name: "Script", type: "code", urlRuleUid: "docs", code: "function dynamicBookmark() {}" },
    { uid: "missing", name: "Missing rule", type: "rule", urlRuleUid: "deleted", code: "" },
  ];
  await saveConfig(config);
  await saveDynamicValue("script", { url: "https://example.com/saved", note: "context", updatedAt: 1 });
  mock.supported.mockResolvedValue("unsupported");
  await start(); await visit("https://example.com/docs");
  const values = await loadDynamicValues();
  expect(values.rule).toMatchObject({ url: "https://example.com/docs", title: "Visited page" });
  expect(values.script).toMatchObject({ url: "https://example.com/saved", note: "context", updatedAt: 1 });
  expect(values.missing).toBeUndefined();
  expect(mock.run).not.toHaveBeenCalled();
  await visit("https://example.com/private");
  expect((await loadDynamicValues()).rule).toEqual(values.rule);
  await visit("https://other.com/docs");
  expect((await loadDynamicValues()).rule).toEqual(values.rule);
});

it("applies a code bookmark's blacklist before execution", async () => {
  const config = await loadConfig();
  config.urlRules = [{ uid: "docs", name: "Docs", patterns: ["example.com", "!https://example.com/private"] }];
  config.dynamicBookmarks = [{ uid: "script", name: "Script", type: "code", urlRuleUid: "docs", code: "function dynamicBookmark() {}" }];
  await saveConfig(config);
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/docs" } });
  await start(); await visit("https://example.com/private");
  expect(mock.run).not.toHaveBeenCalled();
  await visit("https://example.com/docs");
  expect((await loadDynamicValues()).script?.url).toBe("https://example.com/docs");
});

it("never runs a dynamic bookmark that is not bound to a URL rule", async () => {
  const config = await loadConfig();
  config.urlRules = [{ uid: "docs", name: "Docs", patterns: ["example.com"] }];
  config.dynamicBookmarks = [
    { uid: "script", name: "Script", type: "code", code: "function dynamicBookmark() {}" },
    { uid: "rule", name: "Rule", type: "rule", code: "" },
  ];
  await saveConfig(config);
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/docs" } });
  await start(); await visit("https://example.com/docs");
  expect(mock.run).not.toHaveBeenCalled();
  expect(await loadDynamicValues()).toEqual({});
});

it("does not save a URL outside the bookmark's rules, so a script cannot send what it sees elsewhere", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/saved", note: "keep", updatedAt: 1 });
  mock.run.mockImplementation(async (_code, context) => ({
    ok: true, value: { newUrl: "https://collector.test/?seen=" + encodeURIComponent(context.url), note: "leak" },
  }));
  await start(); await visit("https://example.com/account");
  expect((await loadDynamicValues()).one).toEqual({ url: "https://example.com/saved", note: "keep", updatedAt: 1 });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/next" } });
  await visit("https://example.com/chapter");
  expect((await loadDynamicValues()).one?.url).toBe("https://example.com/next");
});

it("reports the sandbox status to the options page opened in a tab, but not to web pages", async () => {
  await start();
  const status = { type: "getDynamicSandboxStatus" };
  const optionsTab = { id: "test-extension", url: "chrome-extension://test-extension/options.html", tab: {} };
  expect(await mock.message!(status, optionsTab)).toBe("supported");
  expect(mock.message!(status, { id: "test-extension", url: "https://example.com/", tab: {} })).toBeUndefined();
});

it("updates rewrite bookmarks without code sandbox support and preserves saved values when filtered or outside the rule", async () => {
  const { DEFAULT_REWRITE, REWRITE_EXAMPLE_URL } = await import("../dynamic/rewrite");
  const config = await loadConfig();
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com"] }];
  config.dynamicBookmarks = [{ uid: "rewritten", name: "Rewritten", type: "rewrite", urlRuleUid: "site", code: "", rewrite: DEFAULT_REWRITE }];
  await saveConfig(config);
  mock.supported.mockResolvedValue("unsupported");
  await start(); await visit(REWRITE_EXAMPLE_URL);
  const saved = (await loadDynamicValues()).rewritten;
  expect(saved?.url).toBe("https://example.com/reader/123");
  expect(mock.run).not.toHaveBeenCalled();
  await visit("https://example.com/private");
  expect((await loadDynamicValues()).rewritten).toEqual(saved);
  config.dynamicBookmarks[0]!.rewrite = 'replace "example.com" "collector.test"';
  await saveConfig(config);
  await visit("https://example.com/article/456");
  expect((await loadDynamicValues()).rewritten).toEqual(saved);
});

it("tests draft code using saved context without changing stored values, and denies requests from websites", async () => {
  await definitions();
  await saveDynamicValue("one", { url: "https://example.com/saved", title: "Saved", note: "keep", updatedAt: 1 });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/test", note: "changed", extra: ["original result"] } });
  await start();
  const config = await loadConfig();
  const request = { type: "testDynamicBookmark", bookmark: { ...config.dynamicBookmarks[0], code: "draft code" }, rule: config.urlRules[0], url: "https://example.com/visit" };
  expect(await mock.message!(request, { id: "test-extension", url: "https://example.com/", tab: {} })).toBeUndefined();
  const result = await mock.message!(request, { id: "test-extension", url: "chrome-extension://test-extension/options.html", tab: {} });
  expect(result).toEqual({ ok: true, value: { newUrl: "https://example.com/test", note: "changed", extra: ["original result"] } });
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: null } });
  expect(await mock.message!(request, { id: "test-extension", url: "chrome-extension://test-extension/options.html", tab: {} }))
    .toEqual({ ok: true, value: { newUrl: null } });
  expect(mock.run.mock.calls[0]![0]).toBe("draft code");
  expect(mock.run.mock.calls[0]![1].current.note).toBe("keep");
  expect((await loadDynamicValues()).one).toEqual({ url: "https://example.com/saved", title: "Saved", note: "keep", updatedAt: 1 });
  expect((await loadConfig()).dynamicBookmarks[0]!.code).toBe("function dynamicBookmark() {}");
});

it("keeps both code and rewrite results when the same visit updates multiple bookmarks", async () => {
  const { DEFAULT_REWRITE, REWRITE_EXAMPLE_URL } = await import("../dynamic/rewrite");
  await definitions(["script"]);
  const config = await loadConfig();
  config.dynamicBookmarks.push({ uid: "rewrite", name: "Rewrite", type: "rewrite", urlRuleUid: "site", code: "", rewrite: DEFAULT_REWRITE });
  await saveConfig(config);
  mock.run.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return { ok: true, value: { newUrl: "https://example.com/script" } };
  });
  await start();
  mock.storageDelayMs = 5;
  await visit(REWRITE_EXAMPLE_URL);
  mock.storageDelayMs = 0;
  const values = await loadDynamicValues();
  expect(values.script?.url).toBe("https://example.com/script");
  expect(values.rewrite?.url).toBe("https://example.com/reader/123");
});
