import browser from "webextension-polyfill";
import { probeDesktopConnection } from "../../native/connection";
import { saveWidgetEnabled } from "../../config";
import { browserKind } from "../../browser/windows";

export const browserActions = {
  async setWidgetEnabled(enabled: boolean): Promise<void> {
    await saveWidgetEnabled(enabled);
    await browser.runtime.sendMessage({ type: "setWidgetEnabled", enabled });
  },
  reconnect: () => browser.runtime.sendMessage({ type: "manualReconnect" }),
  resync: () => browser.runtime.sendMessage({ type: "resyncWindows" }),
  desktopState: () =>
    browser.runtime.sendMessage({ type: "getDesktopState" }) as Promise<
      { state?: string; detail?: string } | undefined
    >,
  commands: () => browser.commands.getAll(),
  probeDesktop: probeDesktopConnection,
  resetMenuPosition: (menuUid: string) =>
    browser.runtime.sendMessage({ type: "resetMenuLayout", menuUid }),
  openShortcutSettings(): Promise<browser.Tabs.Tab> {
    const kind = browserKind();
    return browser.tabs.create({
      url:
        kind === "firefox"
          ? "about:addons"
          : kind === "edge"
            ? "edge://extensions/shortcuts"
            : "chrome://extensions/shortcuts",
    });
  },
  onDesktopState(listener: (state: string) => void): () => void {
    const receive = (message: unknown): void => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "desktopStateChanged" &&
        "state" in message &&
        typeof message.state === "string"
      )
        listener(message.state);
    };
    browser.runtime.onMessage.addListener(receive);
    return () => browser.runtime.onMessage.removeListener(receive);
  },
  async diagnosticsEnabled(): Promise<boolean> {
    return Boolean((await browser.storage.local.get("debugLoggingEnabled")).debugLoggingEnabled);
  },
  async setDiagnosticsEnabled(enabled: boolean): Promise<void> {
    await browser.storage.local.set({ debugLoggingEnabled: enabled });
    await browser.runtime.sendMessage({ type: "setDebugLogging", enabled }).catch(() => {});
  },
  async debugInfo(): Promise<unknown> {
    const extension = await browser.runtime
      .sendMessage({ type: "getDebugInfo" })
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
