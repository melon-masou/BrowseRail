// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type browser from "webextension-polyfill";
import type { Storage } from "webextension-polyfill";

const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  sendMessage: vi.fn<(message?: unknown) => Promise<unknown>>(async () => ({ state: "disconnected" })),
  bookmarkTree: [{id: "0", title: "", children: []}] as browser.Bookmarks.BookmarkTreeNode[],
  storageListeners: [] as Array<(changes: Record<string, Storage.StorageChange>, area: string) => void>,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, mock.storage[key]])),
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
  return (await import("../../config")).loadConfig();
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
  mock.sendMessage.mockReset().mockResolvedValue({ state: "disconnected" });
  mock.storage = {};
  mock.storageListeners = [];
  mock.bookmarkTree = [{id: "0", title: "", children: []}];
  const { loadConfig } = await import("../../config");
  const config = await loadConfig();
  config.instanceLabel = "Original instance";
  config.panel.menus = [];
  mock.storage.config = config;
  document.open();
  const html = readFileSync(new NodeURL("./index.html", import.meta.url), "utf8");
  // Loads the page's own markup as the test fixture.
  // eslint-disable-next-line no-unsanitized/method
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
  const remove = document.querySelector("#static-list article .menu-remove-btn");
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

it("filters static bookmarks by any selected tag and drags before the target in the complete saved order", async () => {
  button("custom-bookmarks-tab").click();
  button("static-tab").click();
  function add(name: string, tags: string[]): void {
    button("add-static-btn").click();
    const card = document.querySelector("#static-list article:last-child")!;
    const nameInput = card.querySelector<HTMLInputElement>(".dynamic-name-input")!;
    nameInput.value = name;
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    for (const tag of tags) {
      const tagInput = document.querySelector<HTMLInputElement>("#static-list article:last-child .static-tag-input")!;
      tagInput.value = tag;
      tagInput.dispatchEvent(new Event("input", { bubbles: true }));
      tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }
  }
  function filter(tag: string): void {
    const control = [...document.querySelectorAll<HTMLButtonElement>("#static-tag-filters button")].find(value => value.textContent === tag)!;
    control.click();
  }
  function visibleNames(): string[] {
    return [...document.querySelectorAll<HTMLInputElement>("#static-list .dynamic-name-input")].map(value => value.value);
  }
  add("A", ["work"]);
  add("Hidden", ["reading"]);
  add("B", ["work", "personal"]);
  add("C", ["personal"]);
  filter("work");
  expect(visibleNames()).toEqual(["A", "B"]);
  const cards = [...document.querySelectorAll<HTMLElement>("#static-list article")];
  cards[1]!.querySelector(".drag-handle-btn")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  cards[1]!.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true }));
  cards[0]!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true }));
  expect(visibleNames()).toEqual(["B", "A"]);
  filter("personal");
  expect(visibleNames()).toEqual(["B", "A", "C"]);
  await save();
  expect((await savedConfig()).staticBookmarks.map(value => value.name)).toEqual(["B", "A", "Hidden", "C"]);
});

it("refuses to save a dynamic bookmark without a URL rule", async () => {
  button("custom-bookmarks-tab").click();
  button("add-dynamic-btn").click();
  await save();
  expect(document.getElementById("status")!.textContent).toContain("URL rule");
  expect((await savedConfig()).dynamicBookmarks).toEqual([]);
});

it("refreshes a dynamic bookmark's current URL while retaining unsaved edits", async () => {
  button("custom-bookmarks-tab").click();
  button("add-dynamic-btn").click();
  const card = document.querySelector<HTMLElement>("#dynamic-list article");
  const name = card?.querySelector<HTMLInputElement>(".dynamic-name-input");
  if (!card?.dataset.recordId || !name) throw new Error("Missing dynamic bookmark");
  name.value = "Unsaved name";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  const { DYNAMIC_VALUE_STORAGE_PREFIX, saveDynamicValue } = await import("../../config");
  const key = DYNAMIC_VALUE_STORAGE_PREFIX + card.dataset.recordId;
  await saveDynamicValue(card.dataset.recordId, { url: "https://example.com/updated", updatedAt: 1 });
  for (const listener of mock.storageListeners) listener({ [key]: { newValue: mock.storage[key] } }, "local");
  await vi.waitFor(() => expect(document.querySelector("#dynamic-list .dynamic-current-chip")?.textContent).toContain("https://example.com/updated"));
  expect(document.querySelector<HTMLInputElement>("#dynamic-list .dynamic-name-input")?.value).toBe("Unsaved name");
  expect((await savedConfig()).dynamicBookmarks).toEqual([]);
});

it.each(["rewrite", "code"])("tests unsaved dynamic bookmark edits and shows the output without saving (%s)", async type => {
  button("url-rules-tab").click(); button("add-url-rule-btn").click();
  const patterns = document.querySelector("#url-rules-list textarea");
  if (!(patterns instanceof HTMLTextAreaElement)) throw new Error("Missing URL pattern editor");
  patterns.value = "example.com";
  patterns.dispatchEvent(new Event("input", { bubbles: true }));
  button("custom-bookmarks-tab").click(); button("add-dynamic-btn").click();
  const ruleSelect = document.querySelector("#dynamic-list select");
  if (!(ruleSelect instanceof HTMLSelectElement)) throw new Error("Missing URL rule selector");
  ruleSelect.value = ruleSelect.options[1]!.value;
  ruleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  const mode = Array.from(document.querySelectorAll("#dynamic-list label")).find(label => label.textContent === (type === "code" ? "Custom code" : "Regex rewrite"))?.querySelector("input");
  if (!(mode instanceof HTMLInputElement)) throw new Error("Missing update mode");
  mode.click();
  const editor = document.querySelector("#dynamic-list textarea");
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error("Missing dynamic editor");
  editor.value = type === "rewrite" ? 'replace "/old" "/new"' : 'function dynamicBookmark({ url }) { return { newUrl: url }; }';
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  const url = document.querySelector(".dynamic-test input");
  if (!(url instanceof HTMLInputElement)) throw new Error("Missing test URL");
  url.value = "https://example.com/old";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  mock.sendMessage.mockImplementation(async message => {
    if (typeof message === "object" && message !== null && "type" in message && message.type === "testDynamicBookmark")
      return { ok: true, value: { newUrl: "https://example.com/new" } };
    return "supported";
  });
  const test = document.querySelector(".dynamic-test button");
  if (!(test instanceof HTMLButtonElement)) throw new Error("Missing test button");
  test.click();
  await vi.waitFor(() => expect(document.querySelector(".dynamic-test-result")?.textContent).toContain("https://example.com/new"));
  expect(document.querySelector(".dynamic-test-result")?.textContent).toBe(type === "rewrite" ? "https://example.com/new" : JSON.stringify({ newUrl: "https://example.com/new" }, null, 2));
  const request = mock.sendMessage.mock.calls.map(([message]) => message).find(message => typeof message === "object" && message !== null && "type" in message && message.type === "testDynamicBookmark");
  expect(request).toMatchObject({ bookmark: { type, [type === "code" ? "code" : "rewrite"]: editor.value }, rule: { patterns: ["example.com"] }, url: "https://example.com/old" });
  expect((await savedConfig()).dynamicBookmarks).toEqual([]);
  const currentEditor = document.querySelector("#dynamic-list textarea");
  if (!(currentEditor instanceof HTMLTextAreaElement)) throw new Error("Missing editor after source refresh");
  currentEditor.value += "\n# changed draft";
  currentEditor.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.querySelector(".dynamic-test-result")?.hasAttribute("hidden")).toBe(true);
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

it.each([
  { type: "rule", includeCode: false },
  { type: "code", includeCode: false },
  { type: "code", includeCode: true },
  { type: "rewrite", includeCode: false },
  { type: "rewrite", includeCode: true },
])("offers script imports only when present and requires opt-in ($type, $includeCode)", async ({ type, includeCode }) => {
  button("custom-bookmarks-tab").click();
  const data = {
    version: 2,
    exportedAt: "2026-10-04T00:00:00.000Z",
    menus: [],
    urlRules: [{ uid: "docs", name: "Docs", patterns: ["example.com"] }],
    dynamicBookmarks: [{ uid: "imported", name: "Imported", type, code: "function dynamicBookmark() {}", urlRuleUid: "docs", ...(type === "rewrite" ? { rewrite: 'replace "/article/" "/reader/"' } : {}) }],
  };
  const fileInput = input("import-file-input");
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File([JSON.stringify(data)], "settings.json")] });
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector("dialog[open]")).not.toBeNull());
  const dialog = document.querySelector("dialog[open]");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("Missing import dialog");
  const scriptChoice = Array.from(dialog.querySelectorAll("label")).find(label => label.textContent === "Dynamic bookmarks with custom code or regex rewrites");
  expect(Boolean(scriptChoice)).toBe(type !== "rule");
  expect(dialog.textContent?.includes("Only import configurations you trust.")).toBe(type !== "rule");
  if (scriptChoice) {
    const checkbox = scriptChoice.querySelector("input");
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("Missing script checkbox");
    expect(checkbox.checked).toBe(false);
    if (includeCode) checkbox.click();
  }
  const confirm = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Import");
  if (!(confirm instanceof HTMLButtonElement)) throw new Error("Missing import button");
  confirm.click();
  await vi.waitFor(() => expect(button("save-btn").classList.contains("is-dirty")).toBe(true));
  await save();
  expect((await savedConfig()).dynamicBookmarks).toEqual(includeCode ? data.dynamicBookmarks : type !== "rule" ? [] : [{ ...data.dynamicBookmarks[0], code: "" }]);
});

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
