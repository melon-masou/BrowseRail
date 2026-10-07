import { AUTO_FONT_SIZE, DEFAULT_AUTO_HIDE_PADDING, normalizeMenuSpacing, type BarAutoHide, type BarAutoHideRange, type MenuSpacing, type MenuOrientation, type ExpandDirection, type ExpandAlignment, type MenuView } from "./menu";
import { isMenuPlacement, type MenuPlacement, type AttachmentMode, type OnTopMode } from "./native";

export interface BarSettings {
  orientation: MenuOrientation;
  autoHide?: BarAutoHide;
  autoHidePadding?: number;
  autoHideRange?: BarAutoHideRange;
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
    ...(view.autoHideRange ? { autoHideRange: { ...view.autoHideRange } } : {}),
    fontFamily: view.fontFamily ?? "",
    buttonFontSize: view.buttonFontSize ?? AUTO_FONT_SIZE,
    popupFontSize: view.popupFontSize ?? AUTO_FONT_SIZE,
    expandAlignment: view.expandAlignment ?? "edge",
    ...(view.expandDirection ? { expandDirection: view.expandDirection } : {}),
  };
}
export function isBarAutoHideRange(value: unknown): value is BarAutoHideRange {
  if (!value || typeof value !== "object") return false;
  const { start, end } = value as BarAutoHideRange;
  return typeof start === "number" && Number.isFinite(start) && start >= 0
    && typeof end === "number" && Number.isFinite(end) && end <= 1 && start < end;
}
export function isBarSettings(value: unknown): value is BarSettings {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (raw.orientation === "row" || raw.orientation === "column")
    && (raw.autoHide === undefined || ["off", "start", "end"].includes(raw.autoHide as string))
    && (raw.autoHidePadding === undefined || typeof raw.autoHidePadding === "number" && Number.isFinite(raw.autoHidePadding) && raw.autoHidePadding >= 0)
    && (raw.autoHideRange === undefined || isBarAutoHideRange(raw.autoHideRange))
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
        ...(config.autoHideRange ? { autoHideRange: { start: config.autoHideRange.start, end: config.autoHideRange.end } } : {}),
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
