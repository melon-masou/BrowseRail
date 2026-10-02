// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { beforeEach, expect, it, vi } from "vitest";
import type { Storage } from "webextension-polyfill";

const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  sendMessage: vi.fn(async () => ({ state: "disconnected" })),
  storageListeners: [] as Array<(changes: Record<string, Storage.StorageChange>, area: string) => void>,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mock.storage[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(mock.storage, values); },
    },
    onChanged: { addListener: (listener: (changes: Record<string, Storage.StorageChange>, area: string) => void) => { mock.storageListeners.push(listener); } },
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://browserail/${path}`,
    getManifest: () => ({ version: "0.1.0" }),
    onMessage: { addListener: vi.fn() }, sendMessage: mock.sendMessage,
  },
  bookmarks: { getTree: async () => [{ id: "0", title: "", children: [] }] },
  commands: { getAll: async () => [] },
  permissions: { onAdded: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
} }));

function input(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${id}`);
  return element;
}
function button(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${id}`);
  return element;
}
function changeLabel(value: string): void {
  input("instance-label").value = value;
  input("instance-label").dispatchEvent(new Event("input", { bubbles: true }));
}
async function savedConfig() {
  return (await import("../config")).loadConfig();
}
async function save(): Promise<void> {
  const form = document.getElementById(button("save-btn").getAttribute("form")!);
  if (!(form instanceof HTMLFormElement)) throw new Error("Save form is unavailable");
  // Happy DOM rejects valid ws:// URL inputs; exercise submission handlers directly.
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(button("save-btn").disabled).toBe(false));
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("confirm", vi.fn(() => true));
  mock.storage = {};
  mock.storageListeners = [];
  const { loadConfig } = await import("../config");
  const config = await loadConfig();
  config.instanceLabel = "Original instance";
  config.panel.menus = [];
  mock.storage.config = config;
  document.open();
  const html = readFileSync(new NodeURL("../../options.html", import.meta.url), "utf8");
  document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  document.close();
  await import("./index");
  await vi.waitFor(() => expect(input("instance-label").value).toBe("Original instance"));
});

it("keeps externally added static bookmarks when saving drafts, without restoring a locally deleted bookmark", async () => {
  button("custom-bookmarks-tab").click();
  button("add-static-btn").click();
  await save();
  const previous = await savedConfig();
  button("add-static-btn").click();
  const remove = document.querySelector("#static-list article button");
  if (!(remove instanceof HTMLButtonElement)) throw new Error("Missing bookmark delete button");
  remove.click();
  const name = document.querySelector("#static-list .dynamic-name-input");
  if (!(name instanceof HTMLInputElement)) throw new Error("Missing bookmark name");
  name.value = "Unsaved draft";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  const external = { uid: "from-context-menu", name: "Current page", url: "https://example.com/current" };
  const updated = { ...previous, staticBookmarks: [...previous.staticBookmarks, external] };
  mock.storage.config = updated;
  for (const listener of mock.storageListeners) listener({ config: { oldValue: previous, newValue: updated } }, "local");
  expect(document.querySelectorAll("#static-list article")).toHaveLength(2);
  await save();
  const saved = await savedConfig();
  expect(saved.staticBookmarks).toEqual([
    expect.objectContaining({ name: "Unsaved draft" }), external,
  ]);
});

it("cancels or discards unsaved instance changes with the native confirmation, retaining other drafts", async () => {
  button("custom-bookmarks-tab").click();
  button("add-static-btn").click();
  expect(document.querySelectorAll("#static-list article")).toHaveLength(1);
  button("instance-tab").click();
  changeLabel("Unsaved instance");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  button("menus-tab").click();
  expect(button("save-btn").textContent).toBe("Save instance");
  expect(input("instance-label").value).toBe("Unsaved instance");
  expect((await savedConfig()).instanceLabel).toBe("Original instance");
  confirm.mockReturnValue(true);
  button("custom-bookmarks-tab").click();
  expect(input("instance-label").value).toBe("Original instance");
  expect(document.querySelectorAll("#static-list article")).toHaveLength(1);
  expect(button("save-btn").textContent).toBe("Save settings");
  await save();
  expect((await savedConfig()).staticBookmarks).toHaveLength(1);
  expect((await savedConfig()).instanceLabel).toBe("Original instance");
  confirm.mockRestore();
});

it("saves the instance separately, and freely switches other tabs before saving their combined drafts", async () => {
  button("custom-bookmarks-tab").click();
  button("add-static-btn").click();
  button("instance-tab").click();
  changeLabel("Saved instance");
  await save();
  expect((await savedConfig()).instanceLabel).toBe("Saved instance");
  expect((await savedConfig()).staticBookmarks).toHaveLength(0);
  const confirm = vi.spyOn(window, "confirm");
  button("custom-bookmarks-tab").click();
  button("temporary-tab").click();
  button("add-temporary-btn").click();
  button("shortcuts-tab").click();
  button("url-rules-tab").click();
  expect(confirm).not.toHaveBeenCalled();
  await save();
  expect((await savedConfig()).staticBookmarks).toHaveLength(1);
  expect((await savedConfig()).temporaryBookmarks).toHaveLength(1);
  expect((await savedConfig()).instanceLabel).toBe("Saved instance");
  confirm.mockRestore();
});
