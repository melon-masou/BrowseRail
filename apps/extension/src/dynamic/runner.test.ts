import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  message: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: { runtime: {
  getManifest: () => ({ sandbox: { pages: ["sandbox.html"] } }),
  sendMessage: api.message,
} } }));
beforeEach(() => {
  vi.resetModules();
  api.message.mockReset(); api.create.mockReset(); api.close.mockReset(); api.exists.mockReset();
  api.exists.mockResolvedValue(false); api.create.mockResolvedValue(undefined); api.close.mockResolvedValue(undefined);
  vi.stubGlobal("chrome", { offscreen: { createDocument: api.create, closeDocument: api.close, hasDocument: api.exists } });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps an initialization failure until the background restarts, then probes again", async () => {
  api.message.mockResolvedValue("failed");
  let runner = await import("./runner");
  expect(await runner.initializeSandbox()).toBe("failed");
  api.message.mockResolvedValue("supported");
  expect(await runner.initializeSandbox()).toBe("failed");
  expect(await runner.runDynamic("function dynamicBookmark() {}", {})).toMatchObject({ ok: false, error: "sandbox initialization failed" });
  expect(api.message).toHaveBeenCalledTimes(1);
  vi.resetModules();
  runner = await import("./runner");
  expect(await runner.initializeSandbox()).toBe("supported");
  expect(api.message).toHaveBeenCalledTimes(2);
});

it("reuses the initialized sandbox for repeated executions", async () => {
  api.message.mockImplementation(async message => message.__dynHost === "probe" ? "supported" : { ok: true, value: { note: "saved" } });
  const runner = await import("./runner");
  await Promise.all([runner.initializeSandbox(), runner.initializeSandbox()]);
  expect(await runner.runDynamic("function dynamicBookmark() {}", {})).toMatchObject({ ok: true });
  expect(await runner.runDynamic("function dynamicBookmark() {}", {})).toMatchObject({ ok: true });
  expect(api.message.mock.calls.filter(([message]) => message.__dynHost === "probe")).toHaveLength(1);
});

it("reports document creation failures as initialization failure rather than unsupported", async () => {
  api.create.mockRejectedValue(new Error("creation failed"));
  const runner = await import("./runner");
  expect(await runner.initializeSandbox()).toBe("failed");
  expect(await runner.runDynamic("function dynamicBookmark() {}", {})).toMatchObject({ error: "sandbox initialization failed" });
});

it("executes fixed URL rewrites independently of sandbox support", async () => {
  api.message.mockImplementation(async message => message.__dynHost === "probe" ? "unsupported" : { ok: true, url: "https://example.com/reader/123" });
  const runner = await import("./runner");
  expect(await runner.initializeSandbox()).toBe("unsupported");
  expect(await runner.runRewrite('replace "/article/" "/reader/"', "https://example.com/article/123"))
    .toEqual({ ok: true, url: "https://example.com/reader/123" });
});

it.each([undefined, {}, { offscreen: {} }])("rewrites directly when offscreen is unavailable (%j)", async chrome => {
  vi.stubGlobal("chrome", chrome);
  const runner = await import("./runner");
  expect(await runner.runRewrite('filter "example.com"\nreplace "/article/" "/reader/"', "https://example.com/article/123"))
    .toEqual({ ok: true, url: "https://example.com/reader/123" });
  expect(await runner.runRewrite('exclude "/private/"', "https://example.com/private/123"))
    .toMatchObject({ ok: true, url: null });
  expect(await runner.runRewrite('replace "[" ""', "https://example.com/"))
    .toMatchObject({ ok: false });
});

it("preserves worker failures instead of retrying a timed-out rewrite synchronously", async () => {
  api.message.mockResolvedValue({ ok: false, error: "Rewrite execution timeout" });
  const runner = await import("./runner");
  expect(await runner.runRewrite('replace "/article/" "/reader/"', "https://example.com/article/123"))
    .toEqual({ ok: false, error: "Rewrite execution timeout" });
});
