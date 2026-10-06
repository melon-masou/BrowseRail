import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  message: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  exists: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: { runtime: {
  sendMessage: api.message,
} } }));
beforeEach(() => {
  vi.resetModules();
  api.message.mockReset(); api.create.mockReset(); api.close.mockReset(); api.exists.mockReset();
  api.exists.mockResolvedValue(false); api.create.mockResolvedValue(undefined); api.close.mockResolvedValue(undefined);
  vi.stubGlobal("chrome", { offscreen: { createDocument: api.create, closeDocument: api.close, hasDocument: api.exists } });
});
afterEach(() => vi.unstubAllGlobals());

it("executes URL rewrites through the offscreen worker host", async () => {
  api.message.mockResolvedValue({ ok: true, url: "https://example.com/reader/123" });
  const runner = await import("./runner");
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
