import { expect, it } from "vitest";
import { barSettingsFromView, defaultBarSettings, defaultNativeBarSettings, isBarAutoHideRange, isBarSettings, normalizeBarConfigurations } from "./bar";

it.each([0, .5, 1])("preserves a fully hidden band at %s through configuration validation", position => {
  const range = { start: position, end: position };
  const config = { ...defaultBarSettings(), autoHide: "start", autoHideRange: range,
    placement: { boundPosition: { anchor: "topLeft", offsetX: 0, offsetY: 0 } } };
  expect(isBarAutoHideRange(range)).toBe(true);
  expect(normalizeBarConfigurations({ browser: { bar: config } }).browser.bar?.autoHideRange).toEqual(range);
});

it("rejects crossed boundaries and bands outside the bar", () => {
  for (const range of [{ start: .6, end: .4 }, { start: -.1, end: 0 }, { start: 1, end: 1.1 }]) {
    expect(isBarAutoHideRange(range)).toBe(false);
  }
});

it.each([.01, .85, 1])("round-trips icon size %s through browser and native storage into the rendered view", iconSizeRatio => {
  const placement = { boundPosition: { anchor: "topLeft", offsetX: 0, offsetY: 0 } };
  const restored = normalizeBarConfigurations({
    browser: { bar: { ...defaultBarSettings(), iconSizeRatio, placement } },
    native: { bar: { ...defaultNativeBarSettings(), iconSizeRatio, placement } },
  });
  for (const mode of ["browser", "native"] as const) {
    expect(barSettingsFromView(restored[mode].bar!).iconSizeRatio).toBe(iconSizeRatio);
  }
});

it("accepts existing settings without an icon size and rejects sizes outside the selectable range", () => {
  expect(isBarSettings(defaultBarSettings())).toBe(true);
  for (const iconSizeRatio of [0, -.1, 1.01, Infinity, NaN, "100%"])
    expect(isBarSettings({ ...defaultBarSettings(), iconSizeRatio })).toBe(false);
});
