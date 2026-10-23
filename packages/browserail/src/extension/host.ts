import type { BrowserailHost, ConfirmationSource } from "@browserail/browserail/runtime";
import type { RuntimeAdapter } from "@browserail/runtime-adapter";
import type { ExtensionServices } from "@browserail/runtime-adapter/extension";
import type { TemporaryConfirmationResult } from "@browserail/protocol/content";
import { browserKind, listBrowserWindows } from "./lib/browser/windows";
import { runRewrite } from "./features/dynamic/runner";

export function createExtensionHost(runtime: RuntimeAdapter, extension: ExtensionServices): BrowserailHost {
  async function openConfirmation(source: ConfirmationSource, fields: Record<string, string>): Promise<TemporaryConfirmationResult> {
    if (!extension.action?.openPopup || !extension.action?.setPopup) return "prompt";
    const query = new URLSearchParams({
      ...fields,
      sourceTabId: String(source.sourceTabId), sourceWindowId: String(source.sourceWindowId),
    });
    let opened = false;
    try {
      try {
        await extension.action.setPopup({ tabId: source.sourceTabId, popup: `${runtime.resourceUrl("temporary-confirm.html")}?${query}` });
        await extension.action.openPopup({ windowId: source.sourceWindowId });
        opened = true;
      } finally {
        // Clearing the entry affects future icon clicks, not the open document.
        await extension.action.setPopup({ tabId: source.sourceTabId, popup: "" });
      }
    } catch (error) {
      if (opened) throw error;
      return "prompt";
    }
    return "opened";
  }

  return {
    browserKind,
    listWindows: listBrowserWindows,
    commands: () => extension.commands.getAll(),
    async openShortcutSettings(): Promise<void> {
      const kind = browserKind();
      if (kind === "firefox") {
        const commands = extension.commands as typeof extension.commands & { openShortcutSettings(): Promise<void> };
        await commands.openShortcutSettings();
        return;
      }
      await runtime.navigation.create({ url: kind === "edge" ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts" });
    },
    onPermissionsChanged(listener) {
      extension.permissionEvents.onAdded.addListener(listener);
      extension.permissionEvents.onRemoved.addListener(listener);
      return () => {
        extension.permissionEvents.onAdded.removeListener(listener);
        extension.permissionEvents.onRemoved.removeListener(listener);
      };
    },
    onTabRemoved(listener) {
      extension.tabEvents?.onRemoved?.addListener(listener);
      return () => extension.tabEvents?.onRemoved?.removeListener(listener);
    },
    onTabUpdated(listener) {
      extension.tabEvents?.onUpdated?.addListener(listener);
      return () => extension.tabEvents?.onUpdated?.removeListener(listener);
    },
    openConfirmation,
    runRewrite,
  };
}
