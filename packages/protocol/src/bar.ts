import { AUTO_FONT_SIZE, DEFAULT_AUTO_HIDE_PADDING, normalizeMenuSpacing, type BarAutoHide, type MenuSpacing, type MenuOrientation, type ExpandDirection, type ExpandAlignment, type MenuView } from "./menu";
import { isMenuPlacement, type MenuPlacement, type AttachmentMode, type OnTopMode } from "./native";

export interface BarSettings {
  orientation: MenuOrientation;
  autoHide?: BarAutoHide;
  autoHidePadding?: number;
  fontFamily?: string;
  buttonFontSize: number;
  popupFontSize: number;
  expandDirection?: ExpandDirection;
  expandAlignment: ExpandAlignment;
}
export interface NativeBarSettings extends BarSettings {
  attachmentMode: AttachmentMode;
  onTopMode: OnTopMode;
}
export const BAR_SETTINGS_GROUPS = ["orientation", "font", "expand", "autoHide", "attachment", "onTop"] as const;
export type BarSettingsGroup = typeof BAR_SETTINGS_GROUPS[number];
export function isBarSettingsGroups(value: unknown): value is BarSettingsGroup[] {
  return Array.isArray(value) && value.every(group => BAR_SETTINGS_GROUPS.includes(group));
}
export function applyBarSettingsGroups<T extends BarSettings>(target: T, source: BarSettings | NativeBarSettings, groups: readonly BarSettingsGroup[]): T {
  const result = { ...target };
  for (const group of groups) {
    switch (group) {
      case "orientation": result.orientation = source.orientation; break;
      case "font": result.fontFamily = source.fontFamily ?? ""; result.buttonFontSize = source.buttonFontSize; result.popupFontSize = source.popupFontSize; break;
      case "autoHide": result.autoHide = source.autoHide ?? "off"; result.autoHidePadding = source.autoHidePadding ?? DEFAULT_AUTO_HIDE_PADDING; break;
      case "expand":
        result.expandAlignment = source.expandAlignment;
        if (source.expandDirection) result.expandDirection = source.expandDirection; else delete result.expandDirection;
        break;
      case "attachment":
        if ("attachmentMode" in result && "attachmentMode" in source) result.attachmentMode = source.attachmentMode;
        break;
      case "onTop":
        if ("onTopMode" in result && "onTopMode" in source && source.attachmentMode !== "free" && "attachmentMode" in target && target.attachmentMode !== "free") result.onTopMode = source.onTopMode;
        break;
    }
  }
  return result;
}
export interface BarConfiguration extends BarSettings, MenuSpacing {
  placement: MenuPlacement;
}
export interface NativeBarConfiguration extends BarConfiguration, NativeBarSettings {}
export interface BarConfigurations {
  native: Record<string, NativeBarConfiguration>;
  browser: Record<string, BarConfiguration>;
}

export function defaultBarSettings(): BarSettings {
  return { orientation: "column", autoHide: "off", autoHidePadding: DEFAULT_AUTO_HIDE_PADDING, fontFamily: "", buttonFontSize: AUTO_FONT_SIZE, popupFontSize: AUTO_FONT_SIZE, expandAlignment: "edge" };
}
export function defaultNativeBarSettings(): NativeBarSettings {
  return { ...defaultBarSettings(), attachmentMode: "lastFocused", onTopMode: "aboveBrowser" };
}
export function barSettingsFromView(view: Pick<MenuView, keyof BarSettings>): BarSettings {
  return {
    orientation: view.orientation,
    autoHide: view.autoHide ?? "off",
    autoHidePadding: view.autoHidePadding ?? DEFAULT_AUTO_HIDE_PADDING,
    fontFamily: view.fontFamily ?? "",
    buttonFontSize: view.buttonFontSize ?? AUTO_FONT_SIZE,
    popupFontSize: view.popupFontSize ?? AUTO_FONT_SIZE,
    expandAlignment: view.expandAlignment ?? "edge",
    ...(view.expandDirection ? { expandDirection: view.expandDirection } : {}),
  };
}
export function isBarSettings(value: unknown): value is BarSettings {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (raw.orientation === "row" || raw.orientation === "column")
    && (raw.autoHide === undefined || ["off", "start", "end"].includes(raw.autoHide as string))
    && (raw.autoHidePadding === undefined || typeof raw.autoHidePadding === "number" && Number.isFinite(raw.autoHidePadding) && raw.autoHidePadding >= 0)
    && (raw.fontFamily === undefined || typeof raw.fontFamily === "string")
    && typeof raw.buttonFontSize === "number" && (raw.buttonFontSize === AUTO_FONT_SIZE || Number.isFinite(raw.buttonFontSize) && raw.buttonFontSize >= 1)
    && typeof raw.popupFontSize === "number" && (raw.popupFontSize === AUTO_FONT_SIZE || Number.isFinite(raw.popupFontSize) && raw.popupFontSize >= 1)
    && (raw.expandDirection === undefined || ["up", "down", "left", "right"].includes(raw.expandDirection as string))
    && (raw.expandAlignment === "edge" || raw.expandAlignment === "center");
}
export function isNativeBarSettings(value: unknown): value is NativeBarSettings {
  if (!isBarSettings(value)) return false;
  const raw = value as NativeBarSettings;
  return ["lastFocused", "all", "free"].includes(raw.attachmentMode)
    && ["aboveBrowser", "alwaysOnTop"].includes(raw.onTopMode);
}

export function normalizeBarConfigurations(value: unknown): BarConfigurations {
  const result: BarConfigurations = { native: Object.create(null) as BarConfigurations["native"], browser: Object.create(null) as BarConfigurations["browser"] };
  if (!value || typeof value !== "object") return result;
  const raw = value as Record<string, unknown>;
  for (const mode of ["native", "browser"] as const) {
    const entries = raw[mode];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    for (const [uid, entry] of Object.entries(entries)) {
      if (!isBarSettings(entry)) continue;
      const config = entry as BarConfiguration;
      if (!isMenuPlacement(config.placement)) continue;
      const placement = config.placement;
      if ([placement.itemWidth, placement.itemHeight].some(v => v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v <= 0))) continue;
      if (placement.freePosition && ![placement.freePosition.x, placement.freePosition.y].every(Number.isFinite)) continue;
      const clean: BarConfiguration = {
        orientation: config.orientation, buttonFontSize: config.buttonFontSize, popupFontSize: config.popupFontSize,
        autoHide: config.autoHide ?? "off",
        autoHidePadding: config.autoHidePadding ?? DEFAULT_AUTO_HIDE_PADDING,
        fontFamily: config.fontFamily?.trim() ?? "",
        expandAlignment: config.expandAlignment,
        ...(config.expandDirection ? { expandDirection: config.expandDirection } : {}),
        ...normalizeMenuSpacing(config), placement: {
          boundPosition: { anchor: placement.boundPosition.anchor, offsetX: placement.boundPosition.offsetX, offsetY: placement.boundPosition.offsetY },
          ...(placement.itemWidth !== undefined ? { itemWidth: placement.itemWidth } : {}),
          ...(placement.itemHeight !== undefined ? { itemHeight: placement.itemHeight } : {}),
          ...(placement.freePosition ? { freePosition: { x: placement.freePosition.x, y: placement.freePosition.y } } : {}),
        },
      };
      if (mode === "native") {
        if (!isNativeBarSettings(entry)) continue;
        result.native[uid] = { ...clean, attachmentMode: entry.attachmentMode, onTopMode: entry.attachmentMode === "free" ? "alwaysOnTop" : entry.onTopMode };
      } else result.browser[uid] = clean;
    }
  }
  return result;
}
