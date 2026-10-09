import { expect, it } from "vitest";
import { defaultBarSettings, isBarAutoHideRange, normalizeBarConfigurations } from "./bar";

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
