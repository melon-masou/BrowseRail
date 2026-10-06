import { beforeEach, expect, it, vi } from "vitest";
import type { Runtime } from "webextension-polyfill";

type Listener = (message: unknown, sender: Runtime.MessageSender) => unknown;
const api = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  external: undefined as Listener | undefined,
  internal: undefined as Listener | undefined,
  origins: [] as string[],
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(api.stored[key])])),
      set: async (values: Record<string, unknown>) => { Object.assign(api.stored, structuredClone(values)); },
    },
    onChanged: { addListener: vi.fn() },
  },
  runtime: {
    id: "browserail-test",
    onMessageExternal: { addListener: (listener: Listener) => { api.external = listener; } },
    onMessage: { addListener: (listener: Listener) => { api.internal = listener; } },
  },
  permissions: {
    contains: async ({ origins }: { origins: string[] }) => origins.every(origin => api.origins.includes(origin)),
    onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() },
  },
} }));
vi.mock("../external-updates/injection", () => ({ createExternalInjection: () => ({ reconcile: async () => {} }) }));
import { loadConfig, saveConfig, loadDynamicValue, saveDynamicValue } from "../config";
import { loadExternalData } from "../config/external-data";
import { saveExternalAuthorization } from "../config/external-authorization-store";
import { initExternalUpdates } from "./external-updates";

const token = "a".repeat(16);
const provider = { id: "provider@example.com" };
const page: Runtime.MessageSender = { id: "browserail-test", tab: { id: 7, index: 0, windowId: 1, active: true, pinned: false, highlighted: true, incognito: false }, frameId: 0, url: "https://source.example/page" };
const bookmarkUpdate = (uid: string, url: string) => ({ type: "bookmark.update", payload: { uid, url } });
const dataUpdate = (key: string, data: unknown) => ({ type: "data.update", payload: { key, data } });

beforeEach(() => { api.stored = {}; api.origins = []; });
async function start() {
  const config = await loadConfig();
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com", "!https://example.com/private"] }];
  config.dynamicBookmarks = ["one", "two"].map(uid => ({ uid, name: uid, type: "external", urlRuleUid: "site" }));
  config.staticBookmarks = [{ uid: "static", name: "Static", url: "https://example.com/static" }];
  await saveConfig(config);
  await saveExternalAuthorization({ extensionsEnabled: true, extensionIds: [provider.id], userscriptEnabled: true, token });
  api.origins = ["https://source.example/*"];
  const sync = vi.fn();
  initExternalUpdates(sync);
  return { config, sync };
}

it("allows only whitelisted extensions and saves independent KV keys without changing bookmark definitions", async () => {
  const { config, sync } = await start();
  const update = dataUpdate("context", { chapter: 123 });
  expect(await api.external!(update, { id: "unknown" })).toEqual({ ok: false, error: "unauthorized" });
  expect(await api.external!(update, {})).toEqual({ ok: false, error: "unauthorized" });
  expect(await loadExternalData("context")).toBeUndefined();
  expect(await api.external!(update, provider)).toEqual({ ok: true });
  await Promise.all([
    api.external!(dataUpdate("other", [1, true, "text"]), provider),
    api.external!(dataUpdate("context", "replacement"), provider),
  ]);
  expect(await loadExternalData("context")).toBe("replacement");
  expect(await loadExternalData("other")).toEqual([1, true, "text"]);
  expect(await loadConfig()).toEqual(config);
  expect(await loadDynamicValue("one")).toBeUndefined();
  expect(sync).not.toHaveBeenCalled();
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [provider.id], userscriptEnabled: true, token });
  expect(await api.external!(dataUpdate("context", "blocked"), provider)).toEqual({ ok: false, error: "unauthorized" });
  expect(await loadExternalData("context")).toBe("replacement");
  await saveExternalAuthorization({ extensionsEnabled: true, extensionIds: [provider.id], userscriptEnabled: true, token });
  expect(await api.external!(dataUpdate("context", "enabled again"), provider)).toEqual({ ok: true });
});

it("updates one dynamic bookmark runtime URL within its rule, preserving notes and other bookmarks", async () => {
  const { sync } = await start();
  await saveDynamicValue("one", { url: "https://example.com/old", note: "keep", updatedAt: 1 });
  await saveDynamicValue("two", { url: "https://example.com/two", updatedAt: 1 });
  expect(await api.external!(bookmarkUpdate("one", "https://example.com/new"), provider)).toEqual({ ok: true });
  expect(await loadDynamicValue("one")).toMatchObject({ url: "https://example.com/new", note: "keep" });
  expect(await loadDynamicValue("two")).toEqual({ url: "https://example.com/two", updatedAt: 1 });
  expect(sync).toHaveBeenCalledOnce();
  await api.external!(bookmarkUpdate("one", "https://example.com/new"), provider);
  expect(sync).toHaveBeenCalledOnce();
  for (const url of ["https://elsewhere.example/", "https://example.com/private/account"])
    expect(await api.external!(bookmarkUpdate("one", url), provider)).toEqual({ ok: false, error: "outsideUrlRule" });
  expect(await api.external!(bookmarkUpdate("one", "javascript:alert(1)"), provider)).toEqual({ ok: false, error: "invalidMessage" });
  expect(await api.external!(bookmarkUpdate("static", "https://example.com/new"), provider)).toEqual({ ok: false, error: "unknownBookmark" });
  const config = await loadConfig();
  config.dynamicBookmarks.push({ uid: "automatic", name: "Automatic", type: "rule", urlRuleUid: "site" });
  await saveConfig(config);
  expect(await api.external!(bookmarkUpdate("automatic", "https://example.com/new"), provider)).toEqual({ ok: false, error: "unknownBookmark" });
  expect((await loadDynamicValue("one"))?.url).toBe("https://example.com/new");
});

it("rejects external URL updates that disguise an allowed domain in a different host or path", async () => {
  const { config, sync } = await start();
  config.urlRules[0]!.patterns = ["https://*.example.com/*"];
  await saveConfig(config);
  await saveDynamicValue("one", { url: "https://example.com/keep", updatedAt: 1 });
  for (const url of ["https://evil.com/path.example.com/secret", "https://example.com.evil.com/", "https://example.com@evil.com/"])
    expect(await api.external!(bookmarkUpdate("one", url), provider)).toEqual({ ok: false, error: "outsideUrlRule" });
  expect((await loadDynamicValue("one"))?.url).toBe("https://example.com/keep");
  expect(sync).not.toHaveBeenCalled();
  expect(await api.external!(bookmarkUpdate("one", "https://app.example.com/new"), provider)).toEqual({ ok: true });
});

it("checks userscript token and trusted page metadata for the same protocol, including revocation", async () => {
  await start();
  const relay = (message: unknown, suppliedToken = token) => ({ type: "externalUpdate", token: suppliedToken, message });
  expect(await api.internal!({ type: "externalReceiverConfig" }, page)).toEqual({ token });
  expect(await api.internal!(relay(dataUpdate("context", 3)), page)).toEqual({ ok: true });
  expect(await api.internal!(relay(bookmarkUpdate("one", "https://example.com/from-script")), page)).toEqual({ ok: true });
  expect(await api.internal!(relay(dataUpdate("context", 4), "wrong"), page)).toEqual({ ok: false, error: "unauthorized" });
  for (const sender of [
    { ...page, id: "foreign-extension" },
    { ...page, frameId: 1 },
    { ...page, url: "https://ungranted.example/" },
    { id: "browserail-test", url: "chrome-extension://browserail-test/options.html" },
  ]) {
    expect(await api.internal!(relay(dataUpdate("context", 4)), sender)).toEqual({ ok: false, error: "unauthorized" });
    expect(await api.internal!({ type: "externalReceiverConfig" }, sender)).toEqual({ token: "" });
  }
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: true, token: "b".repeat(16) });
  expect(await api.internal!(relay(dataUpdate("context", 4)), page)).toEqual({ ok: false, error: "unauthorized" });
  expect(await api.external!(dataUpdate("context", 4), provider)).toEqual({ ok: false, error: "unauthorized" });
  await saveExternalAuthorization({ extensionsEnabled: false, extensionIds: [], userscriptEnabled: false, token });
  expect(await api.internal!(relay(dataUpdate("context", 4)), page)).toEqual({ ok: false, error: "unauthorized" });
  expect(await api.internal!({ type: "externalReceiverConfig" }, page)).toEqual({ token: "" });
  expect(await loadExternalData("context")).toBe(3);
});

it("rejects malformed, oversized and non-JSON writes without changing saved data", async () => {
  await start();
  await api.external!(dataUpdate("context", "keep"), provider);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const message of [
    null, { type: "data.update" }, dataUpdate("", 1), dataUpdate("context", undefined),
    dataUpdate("context", Number.NaN), dataUpdate("context", cyclic), dataUpdate("context", "x".repeat(65537)),
    { type: "config.update", payload: { key: "config", data: {} } },
  ]) expect(await api.external!(message, provider)).toEqual({ ok: false, error: "invalidMessage" });
  expect(await loadExternalData("context")).toBe("keep");
  await api.external!(dataUpdate("config", { safe: true }), provider);
  expect((await loadConfig()).dynamicBookmarks).toHaveLength(2);
  expect(await loadExternalData("config")).toEqual({ safe: true });
});
