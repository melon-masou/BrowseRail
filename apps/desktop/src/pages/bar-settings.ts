import { mountBarSettings } from "@browserail/menu-ui";
import { isNativeBarSettings } from "@browserail/protocol";
import { emitTo, listen } from "@tauri-apps/api/event";
import { showWindowWhenReady } from "../window-ready";

export function initializeBarSettings(root: HTMLElement, query: URLSearchParams): void {
  document.body.dataset.view = "bar-settings";
  const parent = query.get("parent");
  const settings: unknown = JSON.parse(query.get("settings") ?? "null");
  const itemHeight = Number(query.get("itemHeight"));
  if (!parent || !isNativeBarSettings(settings) || !Number.isFinite(itemHeight) || itemHeight <= 0) throw new Error("Bar settings are unavailable");
  const controller = mountBarSettings(root, settings, draft => { void emitTo(parent, "bar-settings-draft", draft); }, itemHeight);
  void listen<number>("bar-settings-item-height", ({ payload }) => {
    if (Number.isFinite(payload) && payload > 0) controller.updateItemHeight(payload);
  }).then(() => showWindowWhenReady());
}
