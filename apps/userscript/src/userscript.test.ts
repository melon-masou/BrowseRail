// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { build } from "vite";
import { resolve } from "node:path";
import { createUserscriptRuntimeAdapter, type UserscriptApi } from "@browserail/runtime-adapter/userscript";

function storageHub() {
  const values = new Map<string, unknown>();
  const listeners = new Map<number, { owner: number; key: string; receive: Parameters<UserscriptApi["addValueChangeListener"]>[1] }>();
  let next = 0;
  function client(): UserscriptApi {
    const owner = ++next;
    const change = (key: string, value: unknown): void => {
      const old = values.get(key);
      if (value === undefined) values.delete(key); else values.set(key, structuredClone(value));
      for (const listener of listeners.values()) if (listener.key === key) listener.receive(key, old, value, listener.owner !== owner);
    };
    return {
      async getValue<T>(key: string, fallback: T): Promise<T> { return structuredClone(values.has(key) ? values.get(key) : fallback) as T; },
      setValue: async (key, value) => change(key, value), deleteValue: async key => change(key, undefined),
      listValues: async () => [...values.keys()],
      async addValueChangeListener(key, receive) { const id = ++next; listeners.set(id, { owner, key, receive }); return id; },
      async removeValueChangeListener(id) { listeners.delete(id); },
      openInTab: vi.fn(), registerMenuCommand: vi.fn(),
      xmlHttpRequest: vi.fn(async () => { throw new Error("Unexpected icon download"); }),
    };
  }
  return { client };
}

function settingsPanels(): ShadowRoot[] {
  const panels: ShadowRoot[] = [];
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const shadow = attach.call(this, options);
    if (this.tagName.toLowerCase() === "browserail-settings") panels.push(shadow);
    return shadow;
  });
  return panels;
}

let settingsFactory: (view: Window) => typeof import("./settings");
beforeAll(async () => {
  const result = await build({ configFile: resolve("settings.vite.config.ts"), logLevel: "silent" });
  if (!Array.isArray(result)) throw new Error("Expected a settings bundle");
  const code = result[0]!.output.find(file => file.type === "chunk")!.code;
  settingsFactory = new Function(`return ${code}`)() as typeof settingsFactory;
});
const live: { destroy(): unknown }[] = [];
beforeEach(() => {
  vi.resetModules();
  document.head.replaceChildren(); document.body.replaceChildren();
  window.location.href = "https://example.com/";
  vi.stubGlobal("__BROWSERAIL_RESOURCES__", { "icons/48.png": "data:image/png;base64," });
  vi.stubGlobal("__BROWSERAIL_REWRITE_WORKER__", "");
  vi.stubGlobal("__BROWSERAIL_SETTINGS__", settingsFactory);
  // happy-dom's child windows omit browser APIs used by the shared settings UI.
  const getWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!.get!;
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockImplementation(function (this: HTMLIFrameElement) {
    const view = getWindow.call(this) as (Window & typeof globalThis) | null;
    if (view) {
      Object.assign(view, { structuredClone, TextEncoder, TextDecoder, fetch });
      vi.spyOn(view, "Function").mockImplementation(() => { throw new EvalError("unsafe-eval is blocked"); });
    }
    return view;
  });
});
afterEach(async () => {
  for (const item of live.splice(0).reverse()) await item.destroy();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("keeps settings across sites, notifies other script instances, and isolates transient session data", async () => {
  const hub = storageHub();
  const first = await createUserscriptRuntimeAdapter(hub.client(), { page: window, openSettings: vi.fn(), resources: {} });
  const second = await createUserscriptRuntimeAdapter(hub.client(), { page: window, openSettings: vi.fn(), resources: {} });
  live.push(first, second);
  const changed = vi.fn();
  second.storage.onChanged.addListener(changed);
  await first.storage.local.set({ config: { staticBookmarks: [{ uid: "docs", url: "https://example.com/docs" }] } });
  expect(await second.storage.local.get("config")).toEqual(await first.storage.local.get("config"));
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ newValue: expect.any(Object) }) }), "local");
  await Promise.all([first.storage.local.set({ one: 1 }), second.storage.local.set({ two: 2 })]);
  expect(await first.storage.local.get(["one", "two"])).toEqual({ one: 1, two: 2 });
  await first.storage.session.set({ edit: true });
  expect(await second.storage.session.get({ edit: false })).toEqual({ edit: false });
  await first.storage.local.remove("one");
  expect(await second.storage.local.get({ one: "missing" })).toEqual({ one: "missing" });
  second.storage.onChanged.removeListener(changed); changed.mockClear();
  await first.storage.local.set({ two: 3 });
  expect(changed).not.toHaveBeenCalled();
});

it("requires registration before business services use a runtime and uses the host selected by the entry", async () => {
  const registry = await import("@browserail/runtime-adapter");
  expect(() => registry.getRuntimeAdapter()).toThrow("Register a runtime adapter");
  const api = storageHub().client();
  vi.stubGlobal("GM", api);
  const { startup } = await import("./index");
  const app = await startup; live.push(app);
  expect(registry.getRuntimeAdapter().host.browserKind()).toBe("userscript");
  await registry.getRuntimeAdapter().storage.local.set({ display_mode: "native" });
  const { loadDisplayMode } = await import("@browserail/browserail/lib/config/index");
  expect(await loadDisplayMode()).toBe("browser");
  expect((await registry.getRuntimeAdapter().storage.local.get("display_mode")).display_mode).toBe("native");
});

it("keeps one editing menu entry showing the current state after menu clicks, settings changes, and changes from another tab", async () => {
  const hub = storageHub();
  const api = hub.client();
  const commands = new Map<string, { label: string; action: () => void }>();
  api.registerMenuCommand = vi.fn<UserscriptApi["registerMenuCommand"]>((label, action, options) => {
    commands.set(options?.id ?? label, { label, action });
  });
  vi.stubGlobal("GM", api);
  const { startup } = await import("./index");
  live.push(await startup);
  const { t } = await import("@browserail/i18n");
  const prefix = `${t("injection.editMenus")}: `;
  const editing = () => [...commands.values()].filter(command => command.label.startsWith(prefix));
  expect(editing().map(command => command.label)).toEqual([prefix + "OFF"]);
  editing()[0]!.action();
  await vi.waitFor(() => expect(editing().map(command => command.label)).toEqual([prefix + "ON"]));

  const { loadBrowserEditing, saveBrowserEditing, BROWSER_EDITING_STORAGE_KEY } = await import("@browserail/browserail/lib/config/index");
  expect(await loadBrowserEditing()).toBe(true);
  await saveBrowserEditing(false);
  await vi.waitFor(() => expect(editing().map(command => command.label)).toEqual([prefix + "OFF"]));
  const remote = await createUserscriptRuntimeAdapter(hub.client(), { page: window, openSettings: vi.fn(), resources: {} });
  live.push(remote);
  await remote.storage.local.set({ [BROWSER_EDITING_STORAGE_KEY]: true });
  await vi.waitFor(() => expect(editing().map(command => command.label)).toEqual([prefix + "ON"]));
});

it("opens the shared settings UI, disables unavailable controls, and retains imported native and browser-bookmark settings when saving", async () => {
  const panels = settingsPanels();
  vi.stubGlobal("GM", storageHub().client());
  const { startup } = await import("./index");
  const app = await startup; live.push(app);
  await app.openSettings();
  const { createOptionsState } = await import("@browserail/browserail/pages/options/state");
  const { createPersistence, loadOptions } = await import("@browserail/browserail/pages/options/persistence");
  const { createBookmarkLibrary } = await import("@browserail/browserail/pages/options/bookmark-library");
  const loaded = await loadOptions();
  const state = createOptionsState(loaded.instance, loaded.settings);
  const library = createBookmarkLibrary(() => state.instance.rootPrefix);
  library.initialize([], false);
  const persistence = createPersistence(state, library); live.push(persistence);
  const { EXPORT_SCHEMA_VERSION } = await import("@browserail/protocol");
  await persistence.importSettings(JSON.stringify({ version: EXPORT_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    menus: [{ uid: "bar", items: [{ uid: "bookmark", type: "bookmark", path: ["Saved", "Docs"], url: "https://example.com/docs" }] }],
    nativeShortcutSets: [{ uid: "native", name: "Desktop", shortcuts: [{ id: "open", key: "F1", type: "bookmark", path: ["Saved", "Docs"], url: "https://example.com/docs" }] }],
  }), { mode: "replace", menus: true, shortcuts: true });
  await persistence.saveSettings();
  const exported = await persistence.exportSettings();
  expect(exported.nativeShortcutSets?.[0]?.shortcuts[0]?.key).toBe("F1");
  expect(exported.menus?.[0]?.items[0]?.path).toEqual(["Saved", "Docs"]);
  const frame = panels[0]!.querySelector("iframe")!;
  const settings = frame.contentDocument!;
  const mode = settings.getElementById("display-mode");
  expect(mode?.tagName).toBe("SELECT");
  expect((mode as HTMLSelectElement).disabled).toBe(true);
  settings.getElementById("shortcuts-tab")!.click();
  const { t } = await import("@browserail/i18n");
  expect(settings.getElementById("shortcuts-panel")?.textContent).toBe(t("shortcuts.unavailable"));
  expect(settings.querySelector("#shortcuts-panel button, #shortcuts-panel input, #shortcuts-panel select")).toBeNull();
  expect(settings.getElementById("settings-save-bar")?.hidden).toBe(true);
  expect(settings.getElementById("site-authorization-controls")?.inert).toBe(true);
  expect(settings.querySelector("#github-link")?.getAttribute("href")).toContain("BrowseRail");
});

it("opens and saves iframe settings with string evaluation blocked, preserving the host and changes after reopening", async () => {
  const panels = settingsPanels();
  const environment = document.createElement("script");
  environment.id = "client-env"; environment.type = "application/json"; environment.textContent = "{}";
  document.head.append(environment);
  const hostButton = document.createElement("button");
  hostButton.textContent = "Host page"; document.body.append(hostButton);
  const hostClick = vi.fn(); hostButton.addEventListener("click", hostClick);
  const api = storageHub().client(); vi.stubGlobal("GM", api);
  const { startup } = await import("./index");
  const app = await startup; live.push(app);
  const { t } = await import("@browserail/i18n");
  const registered = vi.mocked(api.registerMenuCommand).mock.calls.find(([label]) => label === t("action.openOptions"))!;
  registered[1]();
  await vi.waitFor(() => expect(panels[0]?.querySelector("iframe")?.contentDocument?.getElementById("save-btn")).toBeTruthy());
  expect(document.getElementById("client-env")).toBe(environment);
  expect(hostButton.isConnected).toBe(true);
  expect(document.getElementById("save-btn")).toBeNull();
  await app.openSettings();
  expect(panels).toHaveLength(1);

  const view = panels[0]!.querySelector("iframe")!.contentWindow as Window & typeof globalThis;
  const settings = view.document;
  settings.getElementById("instance-tab")!.click();
  const label = settings.getElementById("instance-label") as HTMLInputElement;
  label.value = "Iframe instance";
  label.dispatchEvent(new view.Event("input", { bubbles: true }));
  (settings.getElementById("connection-form") as HTMLFormElement).dispatchEvent(new view.Event("submit", { bubbles: true, cancelable: true }));
  const { loadConfig } = await import("@browserail/browserail/lib/config/index");
  await vi.waitFor(async () => expect((await loadConfig()).instanceLabel).toBe("Iframe instance"));

  panels[0]!.querySelector("button")!.click();
  expect(panels[0]!.host.isConnected).toBe(false);
  hostButton.click(); expect(hostClick).toHaveBeenCalledOnce();
  await app.openSettings();
  expect((panels[1]!.querySelector("iframe")!.contentDocument!.getElementById("instance-label") as HTMLInputElement).value).toBe("Iframe instance");
  panels[1]!.host.remove();
  await app.openSettings();
  expect((panels[2]!.querySelector("iframe")!.contentDocument!.getElementById("instance-label") as HTMLInputElement).value).toBe("Iframe instance");
  await app.destroy();
  expect(panels[2]!.host.isConnected).toBe(false);
});

it("displays the actual initialization error as text and keeps the host page intact", async () => {
  const panels = settingsPanels();
  const host = document.createElement("p"); host.textContent = "Original page"; document.body.append(host);
  vi.stubGlobal("GM", storageHub().client());
  vi.stubGlobal("__BROWSERAIL_SETTINGS__", () => { throw new Error("<blocked>"); });
  const { startup } = await import("./index");
  const app = await startup; live.push(app);
  await expect(app.openSettings()).rejects.toThrow("<blocked>");
  expect(panels[0]!.querySelector("p")?.textContent).toBe("Error: <blocked>");
  expect(panels[0]!.querySelector("blocked")).toBeNull();
  expect(host.isConnected).toBe(true);
  panels[0]!.querySelector("button")!.click();
  vi.stubGlobal("__BROWSERAIL_SETTINGS__", settingsFactory);
  await app.openSettings();
  expect(panels[1]!.querySelector("iframe")!.contentDocument!.getElementById("save-btn")).toBeTruthy();
});

it("downloads missing configured icons on request and renders them without page network access", async () => {
  const panels = settingsPanels();
  const blockedFetch = vi.fn(async () => { throw new TypeError("connect-src blocked"); });
  vi.stubGlobal("fetch", blockedFetch);
  const api = storageHub().client();
  api.xmlHttpRequest = vi.fn(async ({ url }) => {
    let data: string;
    if (url.includes("/lucide@")) data = JSON.stringify({ width: 24, height: 24, icons: { bookmark: { body: '<path d="M6 3h12v18l-6-4-6 4z"/>' } } });
    else if (url.includes("/ph@")) data = JSON.stringify({ width: 256, height: 256, icons: { "house-fill": { body: '<path d="M224 120v96H32z"/>' } } });
    else if (url.endsWith("tags.json")) data = JSON.stringify({ bookmark: ["reading"] });
    else data = 'name: "house", tags: ["home"]';
    return { status: 200, responseText: data };
  });
  const { normalizeConfig } = await import("@browserail/browserail/lib/config/index");
  const config = normalizeConfig(undefined, "Userscript");
  config.panel.menus = [{ uid: "bar", items: [
    { uid: "a", type: "browserAction", browserAction: "back", icon: { type: "lucide", name: "bookmark" } },
    { uid: "b", type: "browserAction", browserAction: "reload", icon: { type: "phosphor", name: "house" } },
  ] }];
  await api.setValue("browserail.local:config", config);
  vi.stubGlobal("GM", api);
  const { startup } = await import("./index");
  const app = await startup; live.push(app);
  await app.openSettings();
  const { resolveItemIcons, loadIconTags } = await import("@browserail/browserail/lib/icons/item-icons");
  const { t } = await import("@browserail/i18n");
  const settings = panels[0]!.querySelector("iframe")!.contentDocument!;
  settings.getElementById("menus-tab")!.click();
  const download = [...settings.querySelectorAll<HTMLButtonElement>("#menus-panel button")]
    .find(button => button.textContent === t("item.iconDownload"))!;
  await vi.waitFor(() => expect(settings.getElementById("menus-panel")!.textContent).toContain(t("menus.iconsMissing", { count: 2 })));
  expect(api.xmlHttpRequest).not.toHaveBeenCalled();
  download.click();
  await vi.waitFor(async () => {
    const icons = await resolveItemIcons([
      { kind: "bookmark", uid: "a", label: "Reading", icon: { type: "lucide", name: "bookmark" } },
      { kind: "bookmark", uid: "b", label: "Home", icon: { type: "phosphor", name: "house" } },
    ]);
    expect(decodeURIComponent(icons[0]!.iconMask!)).toContain('d="M6 3h12v18l-6-4-6 4z"');
    expect(decodeURIComponent(icons[1]!.iconMask!)).toContain('d="M224 120v96H32z"');
  });
  expect((await loadIconTags("lucide")).bookmark).toContain("reading");
  expect((await loadIconTags("phosphor")).house).toContain("home");
  expect(panels[0]!.querySelector("iframe")!.contentDocument!.getElementById("save-btn")).toBeTruthy();
  expect(blockedFetch).not.toHaveBeenCalled();
});

it("routes settings navigation to the local panel and keeps rejecting non-web bookmark URLs", async () => {
  const openSettings = vi.fn();
  const api = storageHub().client();
  const adapter = await createUserscriptRuntimeAdapter(api, { page: window, openSettings, resources: {} });
  live.push(adapter);
  const current = location.href;
  await adapter.navigation.update(1, { url: adapter.resourceUrl("options.html") });
  expect(openSettings).toHaveBeenCalledOnce();
  expect(location.href).toBe(current);
  expect(api.openInTab).not.toHaveBeenCalled();
  await expect(adapter.navigation.update(1, { url: "javascript:alert(1)" })).rejects.toThrow("HTTP and HTTPS");
});

it("renders a saved link and navigates through the registered userscript adapter", async () => {
  const api = storageHub().client();
  const { normalizeConfig } = await import("@browserail/browserail/lib/config/index");
  const config = normalizeConfig(undefined, "Userscript");
  config.staticBookmarks = [{ uid: "docs", name: "Docs", url: "https://example.com/docs" }];
  config.panel.menus = [{ uid: "bar", items: [{ uid: "link", type: "static", staticUid: "docs" }] }];
  await api.setValue("browserail.local:config", config);
  vi.stubGlobal("GM", api);
  const shadows: ShadowRoot[] = [];
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const shadow = attach.call(this, options); shadows.push(shadow); return shadow;
  });
  const { startup } = await import("./index");
  live.push(await startup);
  const shadow = shadows.find(shadow => shadow.host.tagName.toLowerCase() === "browserail-menus");
  expect(shadow).toBeDefined();
  await vi.waitFor(() => expect(shadow!.textContent).toContain("Docs"));
  const { getRuntimeAdapter } = await import("@browserail/runtime-adapter");
  const replace = vi.spyOn(getRuntimeAdapter().navigation, "update");
  const { BAR_SNAPSHOT_MESSAGE, BAR_COMMAND_MESSAGE } = await import("@browserail/protocol/content");
  const snapshot = await getRuntimeAdapter().messaging.send({ type: BAR_SNAPSHOT_MESSAGE }) as import("@browserail/protocol/content").BrowserMenuState;
  const link = snapshot.menus[0]!.view.items.find(item => item.kind === "bookmark" && item.label === "Docs")!;
  await getRuntimeAdapter().messaging.send({ type: BAR_COMMAND_MESSAGE, command: { type: "invoke", menuUid: "bar", actionUid: link.uid } });
  expect(replace).toHaveBeenCalledWith(1, { url: "https://example.com/docs" });
});

it("updates rule bookmarks on initial load and same-document navigation", async () => {
  const api = storageHub().client();
  const { normalizeConfig } = await import("@browserail/browserail/lib/config/index");
  const config = normalizeConfig(undefined, "Userscript");
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com"] }];
  config.dynamicBookmarks = [{ uid: "current", name: "Current", type: "rule", urlRuleUid: "site" }];
  await api.setValue("browserail.local:config", config);
  vi.stubGlobal("GM", api);
  const { startup } = await import("./index"); live.push(await startup);
  const { loadDynamicValue } = await import("@browserail/browserail/lib/config/index");
  await vi.waitFor(async () => expect((await loadDynamicValue("current"))?.url).toBe("https://example.com/"));
  window.history.pushState(null, "", "/next");
  await vi.waitFor(async () => expect((await loadDynamicValue("current"))?.url).toBe("https://example.com/next"), { timeout: 3000 });
});

it("accepts authorized page events and stops accepting them when access is disabled", async () => {
  const api = storageHub().client();
  const { normalizeConfig } = await import("@browserail/browserail/lib/config/index");
  const config = normalizeConfig(undefined, "Userscript");
  config.urlRules = [{ uid: "site", name: "Site", patterns: ["example.com"] }];
  config.dynamicBookmarks = [{ uid: "external", name: "External", type: "external", urlRuleUid: "site" }];
  const authorization = { extensionsEnabled: false, extensionIds: [], userscriptEnabled: true, token: "0123456789abcdef" };
  await api.setValue("browserail.local:config", config);
  await api.setValue("browserail.local:external_authorization", authorization);
  vi.stubGlobal("GM", api);
  const { startup } = await import("./index"); live.push(await startup);
  const { userscriptUpdateEvent } = await import("@browserail/protocol/content");
  const { loadDynamicValue } = await import("@browserail/browserail/lib/config/index");
  const update = (url: string) => document.dispatchEvent(new CustomEvent(userscriptUpdateEvent(authorization.token), {
    detail: JSON.stringify({ type: "bookmark.update", payload: { uid: "external", url } }),
  }));
  update("https://example.com/first");
  await vi.waitFor(async () => expect((await loadDynamicValue("external"))?.url).toBe("https://example.com/first"));
  const { getRuntimeAdapter } = await import("@browserail/runtime-adapter");
  await getRuntimeAdapter().storage.local.set({ external_authorization: { ...authorization, userscriptEnabled: false } });
  update("https://example.com/blocked");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect((await loadDynamicValue("external"))?.url).toBe("https://example.com/first");
});
