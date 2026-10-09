// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type browser from "webextension-polyfill";
import type { Storage } from "webextension-polyfill";

const mock = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
  cloud: {} as Record<string, unknown>,
  sendMessage: vi.fn<(message?: unknown) => Promise<unknown>>(async () => ({ state: "disconnected" })),
  bookmarkTree: [{id: "0", title: "", children: []}] as browser.Bookmarks.BookmarkTreeNode[],
  storageListeners: [] as Array<(changes: Record<string, Storage.StorageChange>, area: string) => void>,
}));
vi.mock("webextension-polyfill", () => ({ default: {
  storage: {
    local: {
      get: async (keys: string | string[] | null) => keys === null ? structuredClone(mock.storage) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, mock.storage[key]])),
      set: async (values: Record<string, unknown>) => { Object.assign(mock.storage, values); },
      remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete mock.storage[key]; },
    },
    sync: {
      get: async () => structuredClone(mock.cloud),
      set: async (values: Record<string, unknown>) => { Object.assign(mock.cloud, structuredClone(values)); },
      remove: async (keys: string[]) => { for (const key of keys) delete mock.cloud[key]; },
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
  mock.cloud = {};
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
  const remove = [...document.querySelectorAll<HTMLButtonElement>("#static-list article button")].find(button => button.ariaLabel === "Delete");
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

it("downloads only after confirmation and preserves instance settings and bar layout", async () => {
  const { uploadCloudSettings } = await import("../../config/cloud-storage");
  const { EXPORT_SCHEMA_VERSION, defaultBarSettings } = await import("@browserail/protocol");
  const { saveBarLayout, loadBarConfigurations, defaultMenuPlacement, saveConfig } = await import("../../config");
  const config = await savedConfig();
  config.panel.menus = [{ uid: "local", items: [] }];
  config.staticBookmarks = [{ uid: "old", name: "Old", url: "https://example.com" }];
  await saveConfig(config);
  const saved = await savedConfig();
  await saveBarLayout("local", "browser", defaultMenuPlacement(), { gapRatio: .3, extraGaps: {} }, defaultBarSettings());
  const layout = await loadBarConfigurations();
  await uploadCloudSettings({ version: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), menus: [] });
  vi.mocked(window.confirm).mockReturnValue(false);
  button("cloud-download").click();
  await vi.waitFor(() => expect(button("cloud-download").disabled).toBe(false));
  expect(await savedConfig()).toEqual(saved);
  vi.mocked(window.confirm).mockReturnValue(true);
  button("cloud-download").click();
  await vi.waitFor(() => expect(document.getElementById("status")!.textContent).toBe("Downloaded"));
  expect(await savedConfig()).toMatchObject({ instanceLabel: "Original instance", desktopWidget: config.desktopWidget, panel: { menus: [] }, staticBookmarks: [], shortcuts: [] });
  expect(await loadBarConfigurations()).toEqual(layout);
});

it("uploads saved settings only after confirmation and keeps local edits out of the cloud", async () => {
  const { downloadCloudSettings } = await import("../../config/cloud-storage");
  button("cloud-upload").click();
  await vi.waitFor(() => expect(document.getElementById("status")!.textContent).toBe("Uploaded"));
  expect((await downloadCloudSettings()).staticBookmarks).toEqual([]);
  button("custom-bookmarks-tab").click();
  button("add-static-btn").click();
  button("cloud-upload").click();
  expect((await downloadCloudSettings()).staticBookmarks).toEqual([]);
  await save();
  vi.mocked(window.confirm).mockReturnValue(false);
  button("cloud-upload").click();
  expect((await downloadCloudSettings()).staticBookmarks).toEqual([]);
  vi.mocked(window.confirm).mockReturnValue(true);
  button("cloud-upload").click();
  await vi.waitFor(() => expect(document.getElementById("status")!.textContent).toBe("Uploaded"));
  expect((await downloadCloudSettings()).staticBookmarks).toEqual((await savedConfig()).staticBookmarks);
});

it("moves static bookmarks up and down under tag filters in the complete saved order", async () => {
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
  function move(index: number, direction: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLElement>("#static-list article")][index]!
      .querySelector<HTMLButtonElement>(`button[title="Move ${direction}"]`)!;
  }
  expect(move(0, "up").disabled).toBe(true);
  expect(move(1, "down").disabled).toBe(true);
  move(1, "up").click();
  expect(visibleNames()).toEqual(["B", "A"]);
  move(0, "down").click();
  expect(visibleNames()).toEqual(["A", "B"]);
  move(1, "up").click();
  expect(visibleNames()).toEqual(["B", "A"]);
  filter("personal");
  expect(visibleNames()).toEqual(["B", "A", "C"]);
  await save();
  expect((await savedConfig()).staticBookmarks.map(value => value.name)).toEqual(["B", "A", "Hidden", "C"]);
});

it("moves menu items up and down without affecting another menu and saves their order", async () => {
  button("menus-tab").click(); button("add-menu").click();
  async function addAction(menuIndex: number, label: string): Promise<void> {
    document.querySelectorAll<HTMLButtonElement>(".menu-add-btn")[menuIndex]!.click();
    button("add-popover-action-btn").click();
    const choice = [...document.querySelectorAll<HTMLButtonElement>(".item-picker-dialog .pick-menu-item")]
      .find(button => button.textContent === label)!;
    choice.click();
    await vi.waitFor(() => expect(document.querySelector(".item-picker-dialog")).toBeNull());
  }
  await addAction(0, "Back"); await addAction(0, "Reload");
  button("add-menu").click(); await addAction(1, "Forward");
  const move = (index: number, direction: string) => document.querySelectorAll<HTMLElement>("#menus .menu-item-row")[index]!
    .querySelector<HTMLButtonElement>(`button[title="Move ${direction}"]`)!;
  expect(move(0, "up").disabled).toBe(true);
  expect(move(1, "down").disabled).toBe(true);
  expect(move(2, "up").disabled).toBe(true);
  expect(move(2, "down").disabled).toBe(true);
  move(0, "down").click();
  await save();
  expect((await savedConfig()).panel.menus.map(menu => menu.items.map(item => item.browserAction)))
    .toEqual([["reload", "back"], ["forward"]]);
  move(1, "up").click();
  await save();
  expect((await savedConfig()).panel.menus.map(menu => menu.items.map(item => item.browserAction)))
    .toEqual([["back", "reload"], ["forward"]]);
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

it("shows an API bookmark's source and raw failure text, then clears the failure after success", async () => {
  button("custom-bookmarks-tab").click();
  button("add-dynamic-btn").click();
  const mode = [...document.querySelectorAll("#dynamic-list label")].find(label => label.textContent === "API update")?.querySelector("input");
  if (!(mode instanceof HTMLInputElement)) throw new Error("Missing API update mode");
  mode.click();
  const card = document.querySelector<HTMLElement>("#dynamic-list article");
  if (!card?.dataset.recordId) throw new Error("Missing dynamic bookmark");
  const { DYNAMIC_VALUE_STORAGE_PREFIX, saveDynamicValue } = await import("../../config");
  const key = DYNAMIC_VALUE_STORAGE_PREFIX + card.dataset.recordId;
  await saveDynamicValue(card.dataset.recordId, {
    updatedAt: 0, source: "provider@example.com", error: "outsideUrlRule", errmsg: "URL does not match the selected rule.",
  });
  for (const listener of mock.storageListeners) listener({ [key]: { newValue: mock.storage[key] } }, "local");
  await vi.waitFor(() => expect(document.querySelector("#dynamic-list article")?.textContent).toContain("outsideUrlRule: URL does not match the selected rule."));
  expect(document.querySelector("#dynamic-list article")?.textContent).toContain("Source: provider@example.com");
  await saveDynamicValue(card.dataset.recordId, { updatedAt: 1, url: "https://example.com/saved", source: "https://source.example/page" });
  for (const listener of mock.storageListeners) listener({ [key]: { newValue: mock.storage[key] } }, "local");
  await vi.waitFor(() => expect(document.querySelector("#dynamic-list article")?.textContent).toContain("Source: https://source.example/page"));
  expect(document.querySelector("#dynamic-list article")?.textContent).not.toContain("outsideUrlRule");
  expect(document.querySelector("#dynamic-list .dynamic-current-chip")?.textContent).toContain("https://example.com/saved");
  expect((await savedConfig()).dynamicBookmarks).toEqual([]);
});

it("tests unsaved rewrite edits and shows the output without saving", async () => {
  const type = "rewrite";
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
  const mode = Array.from(document.querySelectorAll("#dynamic-list label")).find(label => label.textContent === "Regex rewrite")?.querySelector("input");
  if (!(mode instanceof HTMLInputElement)) throw new Error("Missing update mode");
  mode.click();
  const editor = document.querySelector("#dynamic-list textarea");
  if (!(editor instanceof HTMLTextAreaElement)) throw new Error("Missing dynamic editor");
  editor.value = 'replace "/old" "/new"';
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
  expect(document.querySelector(".dynamic-test-result")?.textContent).toBe("https://example.com/new");
  const request = mock.sendMessage.mock.calls.map(([message]) => message).find(message => typeof message === "object" && message !== null && "type" in message && message.type === "testDynamicBookmark");
  expect(request).toMatchObject({ bookmark: { type, rewrite: editor.value }, rule: { patterns: ["example.com"] }, url: "https://example.com/old" });
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
  { type: "rule", includeRewrites: false },
  { type: "external", includeRewrites: false },
  { type: "code", includeRewrites: true },
  { type: "rewrite", includeRewrites: false },
  { type: "rewrite", includeRewrites: true },
])("offers rewrite imports only when present and requires opt-in ($type, $includeRewrites)", async ({ type, includeRewrites }) => {
  button("custom-bookmarks-tab").click();
  const data = {
    version: 2,
    exportedAt: "2026-10-04T00:00:00.000Z",
    menus: [],
    urlRules: [{ uid: "docs", name: "Docs", patterns: ["example.com"] }],
    dynamicBookmarks: [{ uid: "imported", name: "Imported", type, urlRuleUid: "docs", ...(type === "rewrite" ? { rewrite: 'replace "/article/" "/reader/"' } : {}) }],
  };
  const fileInput = input("import-file-input");
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File([JSON.stringify(data)], "settings.json")] });
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector("dialog[open]")).not.toBeNull());
  const dialog = document.querySelector("dialog[open]");
  if (!(dialog instanceof HTMLDialogElement)) throw new Error("Missing import dialog");
  const rewriteChoice = Array.from(dialog.querySelectorAll("label")).find(label => label.textContent === "Dynamic bookmarks with regex rewrites");
  expect(Boolean(rewriteChoice)).toBe(type === "rewrite");
  expect(dialog.textContent?.includes("Only import configurations you trust.")).toBe(type === "rewrite");
  if (rewriteChoice) {
    const checkbox = rewriteChoice.querySelector("input");
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("Missing rewrite checkbox");
    expect(checkbox.checked).toBe(false);
    if (includeRewrites) checkbox.click();
  }
  const confirm = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Import");
  if (!(confirm instanceof HTMLButtonElement)) throw new Error("Missing import button");
  confirm.click();
  await vi.waitFor(() => expect(button("save-btn").classList.contains("is-dirty")).toBe(true));
  await save();
  expect((await savedConfig()).dynamicBookmarks).toEqual(type === "code" || (type === "rewrite" && !includeRewrites) ? [] : data.dynamicBookmarks);
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

it("adds a tag folder and switches flattening both ways while preserving its reference and hover setting", async () => {
  button("custom-bookmarks-tab").click();
  button("add-static-btn").click();
  const tagInput = document.querySelector<HTMLInputElement>("#static-list .static-tag-input")!;
  tagInput.value = "work";
  tagInput.dispatchEvent(new Event("input", { bubbles: true }));
  tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await save();
  button("menus-tab").click();
  button("add-menu").click();
  document.querySelector<HTMLButtonElement>(".menu-add-btn")!.click();
  button("add-popover-static-btn").click();
  await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>(".item-picker-dialog")?.open).toBe(true));
  const dialog = document.querySelector<HTMLDialogElement>(".item-picker-dialog")!;
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Tags")!.click();
  const search = dialog.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "work";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  [...dialog.querySelectorAll<HTMLButtonElement>(".pick-menu-item")].find(button => button.textContent?.includes("work"))!.click();
  await vi.waitFor(() => expect(document.querySelectorAll("#menus .menu-item-row")).toHaveLength(1));
  expect(document.querySelector("#menus .menu-item-row")!.textContent).toContain("work");
  await save();
  expect((await savedConfig()).panel.menus[0]!.items).toEqual([
    expect.objectContaining({ type: "staticTag", staticTag: "work" }),
  ]);
  const uid = (await savedConfig()).panel.menus[0]!.items[0]!.uid;
  document.querySelector<HTMLButtonElement>("#menus .item-settings-btn")!.click();
  expect(input("item-setting-flatten").checked).toBe(false);
  input("item-setting-hover-expand").checked = false;
  input("item-setting-hover-expand").dispatchEvent(new Event("change", { bubbles: true }));
  input("item-setting-flatten").checked = true;
  input("item-setting-flatten").dispatchEvent(new Event("change", { bubbles: true }));
  await save();
  expect((await savedConfig()).panel.menus[0]!.items).toEqual([
    expect.objectContaining({ uid, type: "flattenStaticTag", staticTag: "work", expandOnHover: false }),
  ]);
  input("item-setting-flatten").checked = false;
  input("item-setting-flatten").dispatchEvent(new Event("change", { bubbles: true }));
  await save();
  expect((await savedConfig()).panel.menus[0]!.items).toEqual([
    expect.objectContaining({ uid, type: "staticTag", staticTag: "work", expandOnHover: false }),
  ]);
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

it("keeps user drafts separate from live external variables and immediate deletion", async () => {
  mock.storage["external_data:shared"] = { value: "API value" };
  button("custom-bookmarks-tab").click();
  button("variables-tab").click();
  button("add-variable-btn").click();
  const fields = document.querySelectorAll<HTMLInputElement>("#user-variables input");
  const key = fields[0]!;
  const value = fields[1]!;
  key.value = "shared";
  key.dispatchEvent(new Event("input", { bubbles: true }));
  value.value = "User value";
  value.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(document.getElementById("external-variables")!.textContent).toContain("API value"));
  expect((await savedConfig()).userVariables).toEqual({});
  mock.storage["external_data:shared"] = "Updated API value";
  for (const listener of mock.storageListeners) listener({ "external_data:shared": { newValue: "Updated API value" } }, "local");
  await vi.waitFor(() => expect(document.getElementById("external-variables")!.textContent).toContain("Updated API value"));
  expect(key.value).toBe("shared");
  expect(value.value).toBe("User value");
  const remove = document.querySelector("#external-variables button");
  if (!(remove instanceof HTMLButtonElement)) throw new Error("Missing variable delete button");
  remove.click();
  await vi.waitFor(() => expect(mock.storage).not.toHaveProperty("external_data:shared"));
  expect((await savedConfig()).userVariables).toEqual({});
  await save();
  expect((await savedConfig()).userVariables).toEqual({ shared: "User value" });
});

it("inserts source-qualified references at the URL selection and saves the template", async () => {
  mock.storage["external_data:github.author"] = "external-owner";
  mock.storage["external_data:external.only"] = "another value";
  button("custom-bookmarks-tab").click();
  button("variables-tab").click();
  button("add-variable-btn").click();
  const variableFields = document.querySelectorAll<HTMLInputElement>("#user-variables input");
  variableFields[0]!.value = "github.author";
  variableFields[0]!.dispatchEvent(new Event("input", { bubbles: true }));
  variableFields[1]!.value = "user-owner";
  variableFields[1]!.dispatchEvent(new Event("input", { bubbles: true }));
  await save();
  button("static-tab").click();
  button("add-static-btn").click();
  const url = [...document.querySelectorAll<HTMLInputElement>("#static-list input")].find(input => input.ariaLabel === "URL")!;
  const addVariable = [...document.querySelectorAll<HTMLButtonElement>("#static-list button")].find(button => button.textContent === "Add variable")!;
  async function pick(source: string): Promise<void> {
    addVariable.click();
    const sourceChoice = [...document.querySelectorAll<HTMLButtonElement>(".variable-source-popover button")].find(button => button.textContent === source)!;
    sourceChoice.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>(".item-picker-dialog")?.open).toBe(true));
    const dialog = document.querySelector<HTMLDialogElement>(".item-picker-dialog")!;
    if (source === "User variables") expect(dialog.textContent).not.toContain("external.only");
    const search = dialog.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "github";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dialog.textContent).not.toContain("external.only");
    const choice = [...document.querySelectorAll<HTMLButtonElement>(".item-picker-dialog .pick-menu-item")].find(button => button.textContent === "github.author")!;
    choice.click();
  }
  url.value = "https://github.com/REPLACE";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  url.setSelectionRange(url.value.indexOf("REPLACE"), url.value.length);
  await pick("User variables");
  await vi.waitFor(() => expect(url.value).toBe("https://github.com/${user.github.author}"));
  expect(document.activeElement).toBe(url);
  url.value += "?from=";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  url.setSelectionRange(url.value.length, url.value.length);
  await pick("External variables");
  const template = "https://github.com/${user.github.author}?from=${external.github.author}";
  await vi.waitFor(() => expect(url.value).toBe(template));
  await save();
  expect((await savedConfig()).staticBookmarks[0]!.url).toBe(template);
});
