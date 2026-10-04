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
  updated: undefined as ((id: number, change: { url: string }, tab: { active: boolean; title: string }) => void) | undefined,
  supported: vi.fn<() => Promise<"supported" | "unsupported" | "failed">>(),
  run: vi.fn<(code: string, context: Context) => Promise<{ ok: boolean; value?: unknown }>>(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: { local: {
    get: async (key: string) => ({ [key]: mock.storage[key] }),
    set: async (values: Record<string, unknown>) => { Object.assign(mock.storage, values); },
  } },
  runtime: { id: "test-extension", onMessage: { addListener: vi.fn() } },
  tabs: {
    onUpdated: { addListener: (listener: typeof mock.updated) => { mock.updated = listener; } },
    onRemoved: { addListener: vi.fn() },
  },
} }));
vi.mock("../dynamic/runner", () => ({ runDynamic: mock.run, initializeSandbox: mock.supported }));

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); mock.storage = {}; mock.run.mockReset(); mock.supported.mockResolvedValue("supported");
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
  config.dynamicBookmarks = uids.map(uid => ({ uid, name: uid, type: "code", code: "function dynamicBookmark() {}" }));
  await saveConfig(config);
}

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
    { uid: "script", name: "Script", type: "code", code: "function dynamicBookmark() {}" },
    { uid: "missing", name: "Missing rule", type: "rule", urlRuleUid: "deleted", code: "" },
  ];
  await saveConfig(config);
  await saveDynamicValue("script", { url: "https://example.com/saved", note: "context", updatedAt: 1 });
  mock.supported.mockResolvedValue("unsupported");
  await start(); await visit("https://example.com/docs");
  let values = await loadDynamicValues();
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
  config.dynamicBookmarks = [{ uid: "script", name: "Script", type: "code", urlRuleUids: ["docs"], code: "function dynamicBookmark() {}" }];
  await saveConfig(config);
  mock.run.mockResolvedValue({ ok: true, value: { newUrl: "https://example.com/docs" } });
  await start(); await visit("https://example.com/private");
  expect(mock.run).not.toHaveBeenCalled();
  await visit("https://example.com/docs");
  expect((await loadDynamicValues()).script?.url).toBe("https://example.com/docs");
});
