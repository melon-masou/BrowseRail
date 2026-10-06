import { beforeEach, expect, it, vi } from "vitest";
import type { Scripting } from "webextension-polyfill";
import { createExternalInjection } from "./injection";
import { saveExternalAuthorization } from "../config/external-authorization-store";

const api = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>, origins: [] as string[],
  scripts: [] as Scripting.RegisteredContentScript[], register: vi.fn(), update: vi.fn(),
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: { local: {
    get: async (key: string) => ({ [key]: structuredClone(api.stored[key]) }),
    set: async (values: Record<string, unknown>) => { Object.assign(api.stored, structuredClone(values)); },
  } },
  permissions: { getAll: async () => ({ origins: api.origins }) },
  scripting: {
    getRegisteredContentScripts: async ({ ids }: { ids: string[] }) => api.scripts.filter(script => ids.includes(script.id)),
    registerContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { api.register(scripts); api.scripts.push(...scripts); },
    updateContentScripts: async (scripts: Scripting.RegisteredContentScript[]) => { api.update(scripts); for (const script of scripts) api.scripts = api.scripts.map(existing => existing.id === script.id ? script : existing); },
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => { api.scripts = api.scripts.filter(script => !ids.includes(script.id)); },
  },
} }));
beforeEach(() => { api.stored = {}; api.origins = []; api.scripts = []; api.register.mockClear(); api.update.mockClear(); });

it("injects only with explicit userscript access and website permission, independently of menus or display mode", async () => {
  const injection = createExternalInjection();
  api.origins = ["https://example.com/*"];
  await injection.reconcile();
  expect(api.scripts).toHaveLength(0);
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: true, token: "a".repeat(16) });
  await injection.reconcile();
  expect(api.scripts[0]?.matches).toEqual(["https://example.com/*"]);
  await injection.reconcile();
  expect(api.register).toHaveBeenCalledOnce();
  expect(api.update).not.toHaveBeenCalled();
  api.origins = ["https://other.example/*"];
  await injection.reconcile();
  expect(api.scripts[0]?.matches).toEqual(["https://other.example/*"]);
  api.origins = [];
  await injection.reconcile();
  expect(api.scripts).toHaveLength(0);
  api.origins = ["https://example.com/*"];
  await injection.reconcile();
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token: "a".repeat(16) });
  await injection.reconcile();
  expect(api.scripts).toHaveLength(0);
});

it("keeps browser-menu registration when the userscript receiver is disabled", async () => {
  api.scripts = [{ id: "browserail-menus", js: ["content.js"], matches: ["https://example.com/*"] }];
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: true, token: "a".repeat(16) });
  api.origins = ["https://example.com/*"];
  const injection = createExternalInjection();
  await injection.reconcile();
  expect(api.scripts).toHaveLength(2);
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token: "a".repeat(16) });
  await injection.reconcile();
  expect(api.scripts).toEqual([{ id: "browserail-menus", js: ["content.js"], matches: ["https://example.com/*"] }]);
});
