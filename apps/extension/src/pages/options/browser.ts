import browser from "webextension-polyfill";
import { probeDesktopConnection } from "../../lib/desktop/connection";
import {
  loadWidgetEnabled, saveWidgetEnabled, loadShortcutsEnabled, saveShortcutsEnabled,
  WIDGET_ENABLED_STORAGE_KEY, SHORTCUTS_ENABLED_STORAGE_KEY,
} from "../../lib/config";
import { browserKind } from "../../lib/browser/windows";
import {
  DEBUG_INFO_REQUEST, DEBUG_LOGGING_SET, DESKTOP_RECONNECT, DESKTOP_RESYNC_WINDOWS, DESKTOP_STATE_REQUEST, WIDGET_ENABLED_SET,
  isDesktopStateChanged, type DebugInfoRequest, type DebugLoggingSet, type DesktopReconnect, type DesktopResyncWindows,
  type DesktopStateRequest, type WidgetEnabledSet,
} from "../../features/desktop/messages";
import {
  EDITING_SET, EDITING_STATE_REQUEST, isEditingStateChanged, type EditingSet, type EditingState, type EditingStateRequest,
} from "../../features/toolbar/messages";
import { MENU_LAYOUT_RESET, type MenuLayoutReset } from "../../features/bar/messages";
import { request } from "../../lib/messaging";

type RuntimeState = { enabled: boolean; shortcutsEnabled: boolean };

async function runtimeState(): Promise<RuntimeState> {
  const [enabled, shortcutsEnabled] = await Promise.all([loadWidgetEnabled(), loadShortcutsEnabled()]);
  return { enabled, shortcutsEnabled };
}

export const browserActions = {
  runtimeState,
  setShortcutsEnabled: saveShortcutsEnabled,
  onRuntimeState(listener: (state: RuntimeState) => void): () => void {
    const receive: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === "local" && (changes[WIDGET_ENABLED_STORAGE_KEY] || changes[SHORTCUTS_ENABLED_STORAGE_KEY])) {
        void runtimeState().then(listener).catch(error => console.error("BrowseRail runtime state:", error));
      }
    };
    browser.storage.onChanged.addListener(receive);
    return () => browser.storage.onChanged.removeListener(receive);
  },
  async setWidgetEnabled(enabled: boolean): Promise<void> {
    await saveWidgetEnabled(enabled);
    await request<WidgetEnabledSet>({ type: WIDGET_ENABLED_SET, enabled });
  },
  reconnect: () => request<DesktopReconnect>({ type: DESKTOP_RECONNECT }),
  resync: () => request<DesktopResyncWindows>({ type: DESKTOP_RESYNC_WINDOWS }),
  desktopState: () => request<DesktopStateRequest>({ type: DESKTOP_STATE_REQUEST }),
  menuEditingState: () => request<EditingStateRequest>({ type: EDITING_STATE_REQUEST }),
  setMenuEditing: (editing: boolean) => request<EditingSet>({ type: EDITING_SET, editing }),
  onMenuEditingState(listener: (state: EditingState) => void): () => void {
    const receive = (message: unknown): void => {
      if (isEditingStateChanged(message)) listener({ enabled: message.enabled, editing: message.editing });
    };
    browser.runtime.onMessage.addListener(receive);
    return () => browser.runtime.onMessage.removeListener(receive);
  },
  commands: () => browser.commands.getAll(),
  probeDesktop: probeDesktopConnection,
  resetMenuPosition: (menuUid: string) => request<MenuLayoutReset>({ type: MENU_LAYOUT_RESET, menuUid }),
  async openShortcutSettings(): Promise<void> {
    const kind = browserKind();
    if (kind === "firefox") {
      // Firefox blocks privileged about: URLs in tabs.create; use its dedicated API.
      const commands = browser.commands as typeof browser.commands & {
        openShortcutSettings(): Promise<void>;
      };
      await commands.openShortcutSettings();
      return;
    }
    await browser.tabs.create({
      url: kind === "edge" ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts",
    });
  },
  onDesktopState(listener: (state: string) => void): () => void {
    const receive = (message: unknown): void => {
      if (isDesktopStateChanged(message)) listener(message.state);
    };
    browser.runtime.onMessage.addListener(receive);
    return () => browser.runtime.onMessage.removeListener(receive);
  },
  async diagnosticsEnabled(): Promise<boolean> {
    return Boolean((await browser.storage.local.get("debugLoggingEnabled")).debugLoggingEnabled);
  },
  async setDiagnosticsEnabled(enabled: boolean): Promise<void> {
    await browser.storage.local.set({ debugLoggingEnabled: enabled });
    await request<DebugLoggingSet>({ type: DEBUG_LOGGING_SET, enabled }).catch(() => {});
  },
  async debugInfo(): Promise<unknown> {
    const extension = await request<DebugInfoRequest>({ type: DEBUG_INFO_REQUEST })
      .catch((error) => ({ error: String(error) }));
    let desktop: unknown;
    try {
      const response = await fetch("http://127.0.0.1:17654/debug");
      desktop = response.ok
        ? await response.json()
        : { status: response.status, statusText: response.statusText };
    } catch (error) {
      desktop = { error: `Failed to fetch http://127.0.0.1:17654/debug: ${String(error)}` };
    }
    return { timestamp: new Date().toISOString(), extension, desktop };
  },
};
