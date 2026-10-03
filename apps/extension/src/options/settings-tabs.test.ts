// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type browser from "webextension-polyfill";
import type { Storage } from "webextension-polyfill";

const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  sendMessage: vi.fn(async () => ({ state: "disconnected" })),
  bookmarkTree: [{id: "0", title: "", children: []}] as browser.Bookmarks.BookmarkTreeNode[],
  storageListeners: [] as Array<(changes: Record<string, Storage.StorageChange>, area: string) => void>,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mock.storage[key] }),
      set: async (values: Record<string, unknown>) => { Object.assign(mock.storage, values); },
    },
    onChanged: {
      addListener: (listener: (changes: Record<string, Storage.StorageChange>, area: string) => void) => { mock.storageListeners.push(listener); },
      removeListener: (listener: (changes: Record<string, Storage.StorageChange>, area: string) => void) => { mock.storageListeners = mock.storageListeners.filter(existing => existing !== listener); },
    },
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://browserail/${path}`,
    getManifest: () => ({ version: "0.1.0" }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage: mock.sendMessage,
  },
  bookmarks: { getTree: async () => mock.bookmarkTree },
  commands: { getAll: async () => [] },
  permissions: { onAdded: { addListener: vi.fn(), removeListener: vi.fn() }, onRemoved: { addListener: vi.fn(), removeListener: vi.fn() } },
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
  mock.bookmarkTree = [{id: "0", title: "", children: []}];
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
  input("desktop-url").setCustomValidity("Old address error");
  confirm.mockReturnValue(true);
  button("custom-bookmarks-tab").click();
  expect(input("desktop-url").validity.customError).toBe(false);
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

afterEach(() => { window.dispatchEvent(new Event("pagehide")); });

it("releases unsaved-page handlers on exit and mounts a fresh editor without duplicate actions", async () => {
  button("instance-tab").click(); changeLabel("Unsaved page");
  const before = new Event("beforeunload", {cancelable: true});
  window.dispatchEvent(before); expect(before.defaultPrevented).toBe(true);
  window.dispatchEvent(new Event("pagehide"));
  const after = new Event("beforeunload", {cancelable: true});
  window.dispatchEvent(after); expect(after.defaultPrevented).toBe(false);
  await (await import("./page")).mountOptionsPage();
  button("custom-bookmarks-tab").click(); button("add-static-btn").click();
  expect(document.querySelectorAll("#static-list article")).toHaveLength(1);
  await save(); expect((await savedConfig()).staticBookmarks).toHaveLength(1);
});

it("keeps the edited field and caret when an external bookmark is added", async () => {
  button("custom-bookmarks-tab").click(); button("add-static-btn").click();
  const name = document.querySelector("#static-list .dynamic-name-input");
  if (!(name instanceof HTMLInputElement)) throw new Error("Missing bookmark name");
  name.value = "Draft name"; name.dispatchEvent(new Event("input", {bubbles: true}));
  name.focus(); name.setSelectionRange(2, 5);
  const previous = await savedConfig();
  const external = {uid: "external", name: "Other", url: "https://example.com"};
  const updated = {...previous, staticBookmarks: [...previous.staticBookmarks, external]};
  for (const listener of mock.storageListeners) listener({config: {oldValue: previous, newValue: updated}}, "local");
  expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
  const focused = document.activeElement as HTMLInputElement;
  expect(focused.value).toBe("Draft name"); expect(focused.selectionStart).toBe(2); expect(focused.selectionEnd).toBe(5);
});

it("binds a picked bookmark, cancels without editing, and remembers the shared picker directory", async () => {
  mock.bookmarkTree = [{id: "0", title: "", children: [{id: "1", title: "Bookmarks bar", children: [
    {id: "2", title: "Folder", children: [{id: "3", title: "Page", url: "https://example.com/page"}]},
  ]}]}];
  button("menus-tab").click(); button("add-menu").click();
  const addItem = document.querySelector(".menu-add-btn");
  if (!(addItem instanceof HTMLButtonElement)) throw new Error("Missing add item button");
  addItem.click(); button("add-popover-bookmark-btn").click();
  const dialog = document.getElementById("bookmark-picker-dialog") as HTMLDialogElement;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  for (let depth = 0; depth < 2; depth++) {
    const open = document.querySelector("#picker-content .picker-item-open-btn");
    if (!(open instanceof HTMLButtonElement)) throw new Error("Missing folder button");
    open.click();
  }
  const page = document.querySelector("#picker-content .picker-item-row");
  if (!(page instanceof HTMLElement)) throw new Error("Missing bookmark choice");
  page.click(); button("picker-confirm-btn").click();
  await vi.waitFor(() => expect(document.querySelectorAll("#menus .menu-item-row")).toHaveLength(1));
  await save();
  expect((await savedConfig()).panel.menus[0]!.items[0]!.url).toBe("https://example.com/page");
  const again = document.querySelector(".menu-add-btn");
  if (!(again instanceof HTMLButtonElement)) throw new Error("Missing add item button");
  again.click(); button("add-popover-bookmark-btn").click();
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  expect(document.querySelector("#picker-breadcrumbs .current")?.textContent).toBe("Folder");
  button("picker-close-btn").click();
  await save(); expect((await savedConfig()).panel.menus[0]!.items).toHaveLength(1);
});

it("retains the instance draft when notifying the background after saving fails", async () => {
  button("instance-tab").click(); changeLabel("Retry this draft");
  mock.sendMessage.mockRejectedValueOnce(new Error("Background unavailable"));
  await save();
  expect(input("instance-label").value).toBe("Retry this draft");
  expect(button("save-btn").classList.contains("is-dirty")).toBe(true);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  button("menus-tab").click(); expect(confirm).toHaveBeenCalled();
  expect(button("save-btn").textContent).toBe("Save instance");
  confirm.mockRestore();
});
