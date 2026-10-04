import { mountBarSettings, placeBarSettings, type Rect } from "@browserail/menu-ui";
import { isNativeBarSettings, isBarSettingsGroups } from "@browserail/protocol";
import { emitTo, listen } from "@tauri-apps/api/event";
import { showWindowWhenReady } from "../window-ready";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";

export function initializeBarSettings(root: HTMLElement, query: URLSearchParams): void {
  document.body.dataset.view = "bar-settings";
  const parent = query.get("parent");
  const settings: unknown = JSON.parse(query.get("settings") ?? "null");
  const itemHeight = Number(query.get("itemHeight"));
  const positioning: { anchor: Rect; bounds: Rect } = JSON.parse(query.get("positioning") ?? "null");
  const applyToAll: unknown = JSON.parse(query.get("applyToAll") ?? "null");
  if (!parent || !isNativeBarSettings(settings) || !isBarSettingsGroups(applyToAll) || !Number.isFinite(itemHeight) || itemHeight <= 0 || !positioning) throw new Error("Bar settings are unavailable");
  const controller = mountBarSettings(root, settings, (draft, groups) => { void emitTo(parent, "bar-settings-draft", { settings: draft, applyToAll: groups }); }, itemHeight, invoke<string[]>("installed_fonts"), applyToAll);
  void Promise.all([listen<number>("bar-settings-item-height", ({ payload }) => {
    if (Number.isFinite(payload) && payload > 0) controller.updateItemHeight(payload);
  }, { target: getCurrentWindow().label }), listen<"row" | "column">("bar-settings-orientation", ({ payload }) => {
    if (payload === "row" || payload === "column") controller.updateOrientation(payload);
  }, { target: getCurrentWindow().label })]).then(async () => {
    const window = getCurrentWindow();
    const [size, scale] = await Promise.all([window.outerSize(), window.scaleFactor()]);
    const position = placeBarSettings(positioning.anchor, size, positioning.bounds, settings.orientation, 8 * scale);
    await window.setPosition(new PhysicalPosition(Math.round(position.x), Math.round(position.y)));
    await showWindowWhenReady();
  });
}
