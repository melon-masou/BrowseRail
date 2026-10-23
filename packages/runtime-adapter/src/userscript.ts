import type { MessageListener, RuntimeAdapter, StorageArea, StorageChange, TabInfo } from "./contracts";

export interface UserscriptApi {
  getValue<T>(key: string, defaultValue: T): Promise<T>;
  setValue(key: string, value: unknown): Promise<void>;
  deleteValue(key: string): Promise<void>;
  listValues(): Promise<string[]>;
  addValueChangeListener(key: string, listener: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void): Promise<number>;
  removeValueChangeListener(id: number): Promise<void>;
  openInTab(url: string, options: { active: boolean }): unknown;
  registerMenuCommand(label: string, action: () => void, options?: { id: string }): unknown;
}

const PREFIX = "browserail.local:";
const CHANGED = "browserail.changed";
const SETTINGS_URL = "browserail:settings";
type Changes = Record<string, StorageChange>;

export async function createUserscriptRuntimeAdapter(api: UserscriptApi, options: {
  page: Window;
  openSettings(): Promise<void>;
  resources: Record<string, string>;
  resourceData: Record<string, unknown>;
}): Promise<RuntimeAdapter & { destroy(): Promise<void> }> {
  const { page, resources, resourceData } = options;
  const storageListeners = new Set<(changes: Changes, area: string) => void>();
  const messageListeners = new Set<MessageListener>();
  const sessionValues: Record<string, unknown> = {};
  const emit = (changes: Changes, area: string): void => {
    if (Object.keys(changes).length) for (const listener of storageListeners) listener(changes, area);
  };
  const listenerId = await api.addValueChangeListener(CHANGED, (_key, _old, value, remote) => {
    if (remote && value && typeof value === "object" && "changes" in value)
      emit(value.changes as Changes, "local");
  });
  function storage(area: "local" | "session"): StorageArea {
    const read = async (key: string): Promise<unknown> => area === "local" ? api.getValue(PREFIX + key, undefined) : structuredClone(sessionValues[key]);
    const publish = async (changes: Changes): Promise<void> => {
      emit(changes, area);
      if (area === "local" && Object.keys(changes).length) await api.setValue(CHANGED, { id: crypto.randomUUID(), changes });
    };
    return {
      async get(keys = null) {
        const names = keys === null ? area === "local"
          ? (await api.listValues()).filter(key => key.startsWith(PREFIX)).map(key => key.slice(PREFIX.length))
          : Object.keys(sessionValues)
          : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(await Promise.all(names.map(async key => {
          const value = await read(key);
          return [key, value === undefined && keys && typeof keys === "object" && !Array.isArray(keys) ? keys[key] : value];
        })));
      },
      async set(values) {
        const changes: Changes = {};
        for (const [key, value] of Object.entries(values)) {
          const oldValue = await read(key);
          if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
          if (area === "local") await api.setValue(PREFIX + key, value);
          else sessionValues[key] = structuredClone(value);
          changes[key] = { oldValue, newValue: structuredClone(value) };
        }
        await publish(changes);
      },
      async remove(keys) {
        const changes: Changes = {};
        for (const key of typeof keys === "string" ? [keys] : keys) {
          const oldValue = await read(key);
          if (oldValue === undefined) continue;
          if (area === "local") await api.deleteValue(PREFIX + key);
          else delete sessionValues[key];
          changes[key] = { oldValue };
        }
        await publish(changes);
      },
    };
  }
  const unsupported = (): never => { throw new Error("This operation is unavailable in a userscript"); };
  const tab = (): TabInfo => ({ id: 1, windowId: 1, active: true, url: page.location.href, title: page.document.title });
  const requireTab = (id: number): void => { if (id !== 1) throw new Error("Tab is unavailable"); };
  const navigate = async (url: string): Promise<void> => {
    if (url === SETTINGS_URL) { await options.openSettings(); return; }
    const target = new URL(url, page.location.href);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Userscripts can only open HTTP and HTTPS pages");
    page.location.assign(target.href);
  };
  const send = async (message: unknown): Promise<unknown> => {
    // Only this app can use the local message bus; its identity is independent of the host site's URL.
    const sender = { id: "browserail-userscript", url: SETTINGS_URL, frameId: 0, tab: tab() };
    for (const listener of messageListeners) {
      const reply = await listener(message, sender);
      if (reply !== undefined && reply !== false) return reply;
    }
  };
  return {
    storage: {
      local: storage("local"), session: storage("session"), sync: undefined,
      onChanged: { addListener: listener => { storageListeners.add(listener); }, removeListener: listener => { storageListeners.delete(listener); } },
    },
    bookmarks: { isAvailable: async () => false, getTree: unsupported, get: unsupported, create: unsupported },
    navigation: {
      async get(id) { requireTab(id); return tab(); },
      async query(query) { return query.windowId === undefined || query.windowId === 1 ? [tab()] : []; },
      async create(properties) {
        if (properties.url === SETTINGS_URL) { await options.openSettings(); return tab(); }
        const url = new URL(properties.url ?? "about:blank", page.location.href);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Userscripts can only open HTTP and HTTPS pages");
        api.openInTab(url.href, { active: properties.active !== false });
        return { url: url.href, active: properties.active !== false };
      },
      async update(id, properties) { requireTab(id); await navigate(properties.url); return tab(); },
      async goBack(id) { requireTab(id); page.history.back(); },
      async goForward(id) { requireTab(id); page.history.forward(); },
      async reload(id) { requireTab(id); page.location.reload(); },
    },
    messaging: {
      id: "browserail-userscript", send, sendToExtension: unsupported,
      async sendToTab(id, message) { requireTab(id); return send(message); },
      onMessage: { addListener: listener => { messageListeners.add(listener); }, removeListener: listener => { messageListeners.delete(listener); } },
    },
    permissions: {
      getAll: async () => ({ origins: ["http://*/*", "https://*/*"] }),
      contains: async permissions => !permissions.permissions?.length && (permissions.origins ?? []).every(origin => /^(https?|\*):\/\//.test(origin)),
      request: unsupported, remove: unsupported,
    },
    capabilities: { browserBookmarks: false, browserSync: false, websitePermissions: false, browserShortcuts: false, externalExtensions: false, desktopConnection: false },
    resourceUrl(path) {
      if (path === "") return "browserail:";
      if (path === "options.html") return SETTINGS_URL;
      if (!Object.hasOwn(resources, path)) throw new Error(`Resource is unavailable: ${path}`);
      return resources[path]!;
    },
    async resourceJson(path) {
      if (!Object.hasOwn(resourceData, path)) throw new Error(`Resource is unavailable: ${path}`);
      return structuredClone(resourceData[path]);
    },
    platformInfo: async () => ({ os: /Win/.test(page.navigator.platform) ? "win" : /Mac/.test(page.navigator.platform) ? "mac" : "linux" }),
    async destroy() { storageListeners.clear(); messageListeners.clear(); await api.removeValueChangeListener(listenerId); },
  };
}
