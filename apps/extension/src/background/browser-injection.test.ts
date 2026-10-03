import { beforeEach, expect, it, vi } from "vitest";
import type { Scripting } from "webextension-polyfill";

const state = vi.hoisted(() => ({
  origins: [] as string[],
  scripts: [] as Scripting.RegisteredContentScript[],
  register: vi.fn(), update: vi.fn(), unregister: vi.fn(),
  inject: vi.fn(), query: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  permissions: { getAll: async () => ({ origins: state.origins }) },
  scripting: {
    getRegisteredContentScripts: async () => state.scripts,
    registerContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { state.register(scripts); state.scripts = scripts; },
    updateContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { state.update(scripts); state.scripts = scripts; },
    unregisterContentScripts: async () => { state.unregister(); state.scripts = []; },
    executeScript: state.inject,
  },
  tabs: { query: state.query },
} }));
import { createBrowserInjection } from "./browser-injection";

beforeEach(() => {
  state.origins = []; state.scripts = [];
  state.register.mockClear(); state.update.mockClear(); state.unregister.mockClear();
  state.inject.mockClear(); state.query.mockClear();
});

it("registers only authorized browser-mode pages and unregisters for native mode or revoked permissions", async () => {
  const service = createBrowserInjection();
  await service.reconcile(true);
  expect(state.scripts).toEqual([]);
  state.origins = ["https://example.com/*"];
  await service.reconcile(false);
  expect(state.scripts).toEqual([]);
  await service.reconcile(true);
  expect(state.scripts[0]).toMatchObject({ matches: ["https://example.com/*"], runAt: "document_start", allFrames: false });
  await service.reconcile(false);
  expect(state.scripts).toEqual([]);
  await service.reconcile(true);
  state.origins = [];
  await service.reconcile(true);
  expect(state.scripts).toEqual([]);
});

it("updates future-page registration when authorization changes without touching already open tabs", async () => {
  state.origins = ["https://example.com/*"];
  const service = createBrowserInjection();
  await service.reconcile(true);
  state.origins = ["https://other.com/*"];
  await service.reconcile(true);
  expect(state.scripts[0]?.matches).toEqual(["https://other.com/*"]);
  expect(state.update).toHaveBeenCalledOnce();
  expect(state.query).not.toHaveBeenCalled();
  expect(state.inject).not.toHaveBeenCalled();
});

it("does not reregister unchanged permissions during repeated background syncs", async () => {
  state.origins = ["https://example.com/*"];
  const service = createBrowserInjection();
  await service.reconcile(true);
  await service.reconcile(true);
  await service.reconcile(true);
  expect(state.register).toHaveBeenCalledOnce();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.query).not.toHaveBeenCalled();
  expect(state.inject).not.toHaveBeenCalled();
});
