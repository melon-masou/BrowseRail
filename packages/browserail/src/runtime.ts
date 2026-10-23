import type { BrowserKind, BrowserWindowSnapshot } from "@browserail/protocol";
import type { TemporaryConfirmationResult } from "@browserail/protocol/content";
import type { RuntimeAdapter, TabInfo } from "@browserail/runtime-adapter";
import type { RewriteResult } from "./lib/rewrite/rewrite";

export interface BrowserWindowCandidate extends BrowserWindowSnapshot {
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

export interface BrowserailHost {
  browserKind(): BrowserKind;
  listWindows(): Promise<BrowserWindowCandidate[]>;
  commands(): Promise<ShortcutCommand[]>;
  openShortcutSettings(): Promise<void>;
  onPermissionsChanged(listener: () => void): () => void;
  onTabRemoved(listener: (tabId: number) => void): () => void;
  onTabUpdated(listener: (tabId: number, change: { url?: string; status?: string }, tab: TabInfo) => void): () => void;
  openConfirmation(source: ConfirmationSource, fields: Record<string, string>): Promise<TemporaryConfirmationResult>;
  runRewrite(source: string, url: string): Promise<RewriteResult>;
}

// The host entry initializes this module before starting services or mounting UI.
export let runtime: RuntimeAdapter;
export let host: BrowserailHost;

export function initializeBrowserail(adapter: RuntimeAdapter, services: BrowserailHost): void {
  runtime = adapter;
  host = services;
}
