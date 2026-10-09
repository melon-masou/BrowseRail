// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { DEFAULT_MENU_COLOR } from "@browserail/protocol";
import { applyMenuColor, menuFill, menuInk } from "./appearance";

function colors(color: string) {
  const element = document.createElement("div");
  applyMenuColor(element, color);
  return element.style;
}

function hsl(color: string) {
  const match = /^hsl\(([\d.]+) ([\d.]+)% ([\d.]+)% \/ ([\d.]+)\)$/.exec(color);
  if (!match) throw new Error(`Expected an HSL color: ${color}`);
  return { hue: Number(match[1]), saturation: Number(match[2]), lightness: Number(match[3]), alpha: Number(match[4]) };
}

describe("relative menu colors", () => {
  it.each(["--button-norm-fill", "--button-accent"])("keeps brightness changes visible in %s", property => {
    const values = ["#660000", "#cc0000", "#ff3333"].map(color => hsl(colors(color).getPropertyValue(property)));
    expect(values[0]!.lightness).toBeLessThan(values[1]!.lightness);
    expect(values[1]!.lightness).toBeLessThan(values[2]!.lightness);
    expect(values.map(value => value.hue)).toEqual([0, 0, 0]);
  });

  it.each(["--button-norm-fill", "--button-accent"])("keeps saturation changes visible above the former cap in %s", property => {
    const values = ["#bf4040", "#e61919", "#f20d0d"].map(color => hsl(colors(color).getPropertyValue(property)));
    expect(values[0]!.saturation).toBeLessThan(values[1]!.saturation);
    expect(values[1]!.saturation).toBeLessThan(values[2]!.saturation);
    expect(values[0]!.lightness).toBe(values[2]!.lightness);
  });

  it("preserves grayscale, hue and transparency instead of inventing color or opacity", () => {
    for (const color of ["#000", "#888", "#fff"]) {
      const style = colors(color);
      expect(hsl(style.getPropertyValue("--button-norm-fill")).saturation).toBe(0);
      expect(hsl(style.getPropertyValue("--button-accent")).saturation).toBe(0);
    }
    const style = colors("#0000ff80");
    for (const property of ["--button-norm-fill", "--button-accent", "--column-custom-color"]) {
      expect(hsl(style.getPropertyValue(property))).toMatchObject({ hue: 240, alpha: 128 / 255 });
    }
  });

  it("uses the same fill for buttons, shared menu backgrounds and popup columns", () => {
    for (const color of [DEFAULT_MENU_COLOR, "#e51a1a", "#000000", "#ffffff80"]) {
      const style = colors(color);
      expect(style.getPropertyValue("--button-norm-fill")).toBe(menuFill(color));
      expect(style.getPropertyValue("--column-custom-color")).toBe(menuFill(color));
      expect(style.getPropertyValue("--button-ink")).toBe(menuInk(color));
    }
  });

  it("keeps the new default close to the existing muted menu color", () => {
    const color = hsl(menuFill(DEFAULT_MENU_COLOR)!);
    expect(Math.abs(color.hue - 219)).toBeLessThan(1);
    expect(Math.abs(color.saturation - 23)).toBeLessThan(1);
    expect(Math.abs(color.lightness - 34)).toBeLessThan(1);
  });

  it("uses dark text on light fills and white text on dark fills", () => {
    expect(menuInk("#ffffff")).toBe("#161b24");
    expect(menuInk("#000000")).toBe("#ffffff");
    expect(menuInk(DEFAULT_MENU_COLOR)).toBe("#ffffff");
  });
});
