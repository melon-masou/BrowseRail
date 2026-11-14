export interface ListenerEvent<Listener> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageService {
  local: StorageArea;
  session: StorageArea;
  sync: StorageArea | undefined;
  onChanged: ListenerEvent<(changes: Record<string, StorageChange>, area: string) => void>;
}

export interface BookmarkTreeNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  index?: number;
  children?: BookmarkTreeNode[];
}

export interface CreateBookmark {
  parentId?: string;
  index?: number;
  title?: string;
  url?: string;
}

export interface BookmarkService {
  isAvailable(): Promise<boolean>;
  getTree(): Promise<BookmarkTreeNode[]>;
  get(id: string): Promise<BookmarkTreeNode[]>;
  create(details: CreateBookmark): Promise<BookmarkTreeNode>;
}

export interface TabInfo {
  id?: number;
  windowId?: number;
  active?: boolean;
  url?: string;
  pendingUrl?: string;
  title?: string;
}

export interface NavigationService {
  get(tabId: number): Promise<TabInfo>;
  query(query: { active?: boolean; windowId?: number }): Promise<TabInfo[]>;
  create(properties: { active?: boolean; url: string; windowId?: number }): Promise<TabInfo>;
  update(tabId: number, properties: { url: string }): Promise<TabInfo>;
  goBack(tabId: number): Promise<void>;
  goForward(tabId: number): Promise<void>;
  reload(tabId: number): Promise<void>;
}

export interface MessageSender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: TabInfo;
}

export type MessageListener = (message: unknown, sender: MessageSender) => Promise<unknown> | boolean | undefined | void;

export interface MessagingService {
  readonly id: string;
  send(message: unknown): Promise<unknown>;
  onMessage: ListenerEvent<MessageListener>;
  sendToTab(tabId: number, message: unknown, options?: { frameId?: number }): Promise<unknown>;
  sendToExtension(extensionId: string, message: unknown): Promise<unknown>;
}

export interface PermissionSet {
  origins?: string[];
  permissions?: string[];
}

export interface PermissionService {
  getAll(): Promise<PermissionSet>;
  contains(permissions: PermissionSet): Promise<boolean>;
  request(permissions: PermissionSet): Promise<boolean>;
  remove(permissions: PermissionSet): Promise<boolean>;
}

// Capabilities describe the adapter, never a replacement for saved configuration.
export interface RuntimeCapabilities {
  readonly browserBookmarks: boolean;
  readonly browserSync: boolean;
  readonly websitePermissions: boolean;
  readonly browserShortcuts: boolean;
  readonly externalExtensions: boolean;
  readonly desktopConnection: boolean;
}

export interface RuntimeAdapter {
  readonly storage: StorageService;
  readonly bookmarks: BookmarkService;
  readonly navigation: NavigationService;
  readonly messaging: MessagingService;
  readonly permissions: PermissionService;
  readonly capabilities: RuntimeCapabilities;
  resourceUrl(path: string): string;
  resourceJson(path: string): Promise<unknown>;
  platformInfo(): Promise<{ os: string }>;
}

export interface BrowserWindowCandidate {
  uid: string;
  type?: "normal" | "app";
  bounds: { x: number; y: number; width: number; height: number };
  focused: boolean;
  activeTabUrl?: string;
}

export interface ShortcutCommand {
  name?: string;
  description?: string;
  shortcut?: string;
}

export interface ConfirmationSource {
  sourceTabId: number;
  sourceWindowId: number;
}

export type RewriteResult = { ok: true; url: string | null; line?: number } | { ok: false; error: string };

export interface RuntimeHost {
  browserKind(): string;
  listWindows(): Promise<BrowserWindowCandidate[]>;
  getWindowType?(windowUid: string): Promise<BrowserWindowCandidate["type"]>;
  commands(): Promise<ShortcutCommand[]>;
  openShortcutSettings(): Promise<void>;
  onPermissionsChanged(listener: () => void): () => void;
  onTabRemoved(listener: (tabId: number) => void): () => void;
  onTabUpdated(listener: (tabId: number, change: { url?: string; status?: string }, tab: TabInfo) => void): () => void;
  openConfirmation(source: ConfirmationSource, fields: Record<string, string>): Promise<"opened" | "prompt">;
  runRewrite(source: string, url: string): Promise<RewriteResult>;
}
