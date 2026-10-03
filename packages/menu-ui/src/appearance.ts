import { isAutoFontSize, type LayoutEntry } from "@browserail/protocol";
import { barFrameInsets } from "./layout";
import type { BarState } from "./types";

export function applyBarTheme(root: HTMLElement, state: BarState) {
  const buttonFontSize = isAutoFontSize(state.menu.buttonFontSize)
    ? Math.max(6, Math.round(state.itemSize.height / 2.7))
    : parseFontSize(state.menu.buttonFontSize);
  const popupFontSize = state.menu.popupFontSize === undefined || isAutoFontSize(state.menu.popupFontSize)
    ? buttonFontSize : parseFontSize(state.menu.popupFontSize);
  const itemHeight = Math.max(24, Math.round(popupFontSize * 2.7));
  root.style.setProperty("--menu-font-family", state.fontFamily);
  root.style.setProperty("--menu-font-size", `${popupFontSize}px`);
  root.style.setProperty("--menu-item-height", `${itemHeight}px`);
  const frame = barFrameInsets(state.menu);
  root.style.setProperty("--config-bar-frame-x", `${frame.x}px`);
  root.style.setProperty("--config-bar-frame-y", `${frame.y}px`);
  return { buttonFontSize, popupFontSize, itemHeight };
}

function parseFontSize(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (value === "small") return 12;
  if (value === "large") return 15;
  return 13;
}

function parseHex(color: string): { r: number; g: number; b: number; alpha: number } | undefined {
  const hex = color.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return undefined;
  const value = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex.slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
    alpha: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
}

/**
 * Map an item's color onto a consistent chip palette: keep the hue, render a calm
 * muted fill (clamped saturation, fixed dark lightness) with white ink, plus a
 * brighter accent of the same hue for the item's left bar and folder corner. HSL is
 * used on purpose — its per-hue brightness variation keeps the bar livelier than a
 * perceptually-flat space, which reads washed out here. Undefined if unparseable.
 */
function normalizeChip(color: string): { fill: string; ink: string; accent: string; column: string } | undefined {
  const rgb = parseHex(color);
  if (!rgb) return undefined;
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const hue = Math.round(h);
  return {
    fill: `hsl(${hue} ${Math.round(Math.min(s, 0.26) * 100)}% 34% / ${rgb.alpha})`,
    ink: "#ffffff",
    accent: `hsl(${hue} ${Math.round(Math.min(s, 0.48) * 100)}% 46% / ${rgb.alpha})`,
    // Blend the opaque hue first, then restore alpha so the surface color does not make it opaque.
    column: `color-mix(in srgb, color-mix(in srgb, rgb(${rgb.r} ${rgb.g} ${rgb.b}) 45%, var(--surface-base)) ${rgb.alpha * 100}%, transparent)`,
  };
}

export function applyMenuColor(element: HTMLElement, color: string): void {
  element.style.setProperty("--button-custom-color", color);
  const chip = normalizeChip(color);
  if (!chip) return;
  element.style.setProperty("--button-norm-fill", chip.fill);
  element.style.setProperty("--button-ink", chip.ink);
  element.style.setProperty("--button-accent", chip.accent);
  element.style.setProperty("--column-custom-color", chip.column);
}

export function menuButton(
    doc: Document,
    entry: LayoutEntry,
    popup: boolean,
  ): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.toggleAttribute("data-popup", popup);
  button.title = entry.label;

  // Popup rows keep transparent backgrounds; folders can still color their corner marker.
  if (entry.color && (!popup || entry.kind === "folder")) {
    applyMenuColor(button, entry.color);
    if (!popup) button.dataset.hasCustomColor = "true";
  }

  const labelSpan = doc.createElement("span");
  labelSpan.className = "menu-button-label";
  const displayText = entry.kind === "bookmark" || entry.kind === "folder" ? entry.rename : undefined;
  if (displayText) {
    if (popup) {
      labelSpan.textContent =
        displayText === entry.label || entry.label.startsWith(displayText)
          ? entry.label
          : `${displayText} (${entry.label})`;
    } else {
      labelSpan.textContent = displayText;
    }
  } else {
    labelSpan.textContent = entry.label;
  }
  if (!popup && /^\p{Extended_Pictographic}+$/u.test(labelSpan.textContent.trim())) {
    labelSpan.classList.add("menu-button-emoji");
    button.dataset.hasEmoji = "true";
  }
  button.append(labelSpan);

  if (entry.kind === "folder") {
    button.dataset.folder = "";
    button.setAttribute("aria-haspopup", "menu");
  }
  return button;
}
