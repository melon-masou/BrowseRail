import { isAutoFontSize, type LayoutEntry } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import { barFrameInsets } from "./layout";
import type { BarState, PopupPin } from "./types";

export function automaticButtonFontSize(itemHeight: number): number {
  return Math.max(6, Math.round(itemHeight / 2.7));
}

export function applyBarTheme(root: HTMLElement, state: BarState) {
  const buttonFontSize = isAutoFontSize(state.menu.buttonFontSize)
    ? automaticButtonFontSize(state.itemSize.height)
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
  const fill = `hsl(${hue} ${Math.round(Math.min(s, 0.35) * 100)}% 34% / ${rgb.alpha})`;
  return {
    fill,
    ink: "#ffffff",
    accent: `hsl(${hue} ${Math.round(Math.min(s, 0.48) * 100)}% 46% / ${rgb.alpha})`,
    column: fill,
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
  if (!popup && entry.cssClass?.trim()) button.classList.add(...entry.cssClass.trim().split(/\s+/));
  if (!popup) { button.dataset.uid = entry.uid; button.dataset.kind = entry.kind; }
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
  if (entry.kind === "shortcutsToggle") {
    const status = t(entry.on ? "menuAction.shortcutsOn" : "menuAction.shortcutsOff");
    const parts = entry.label.split("{on}");
    parts.forEach((part, index) => {
      if (index > 0) {
        const indicator = doc.createElement("span");
        indicator.className = "shortcut-status-dot";
        indicator.dataset.on = String(entry.on);
        indicator.setAttribute("aria-hidden", "true");
        labelSpan.append(indicator);
      }
      labelSpan.append(doc.createTextNode(part));
    });
    const title = parts.join(status);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", String(entry.on));
  } else if (displayText) {
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
  if (!popup) {
    button.dataset.initial = Array.from(labelSpan.textContent.trim())[0] ?? "";
    if (!button.hasAttribute("aria-label")) button.ariaLabel = labelSpan.textContent;
  }
  if (!popup && /^\p{Extended_Pictographic}+$/u.test(labelSpan.textContent.trim())) {
    labelSpan.classList.add("menu-button-emoji");
    button.dataset.hasEmoji = "true";
  }
  button.append(labelSpan);

  if (entry.kind === "folder") {
    button.dataset.folder = "";
    button.setAttribute("aria-haspopup", "menu");
    // Inline geometry avoids font dependencies and CSP image loads.
    const svgNamespace = "http://www.w3.org/2000/svg";
    const lock = doc.createElementNS(svgNamespace, "svg");
    lock.classList.add("folder-lock-marker");
    lock.setAttribute("viewBox", "0 0 12 12");
    lock.setAttribute("aria-hidden", "true");
    lock.setAttribute("focusable", "false");
    const body = doc.createElementNS(svgNamespace, "rect");
    body.setAttribute("x", "2");
    body.setAttribute("y", "5");
    body.setAttribute("width", "8");
    body.setAttribute("height", "6");
    body.setAttribute("rx", "1");
    const shackle = doc.createElementNS(svgNamespace, "path");
    shackle.setAttribute("d", "M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5");
    lock.append(body, shackle);
    button.append(lock);
  }
  return button;
}

export function applyFolderPin(button: HTMLElement, pin: PopupPin): void {
  if (pin === "none") delete button.dataset.pin;
  else button.dataset.pin = pin;
}

const actionTitles = new WeakMap<HTMLElement, string>();

export function applyActionError(button: HTMLElement, error?: string): void {
  button.querySelector(".menu-action-error")?.remove();
  if (error === undefined) {
    const title = actionTitles.get(button);
    if (title !== undefined) button.title = title;
    actionTitles.delete(button);
    return;
  }
  if (!actionTitles.has(button)) actionTitles.set(button, button.title);
  button.title = `${actionTitles.get(button)}\n${error}`;
  const marker = button.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  marker.classList.add("menu-action-error");
  marker.setAttribute("viewBox", "0 0 12 12");
  marker.setAttribute("aria-hidden", "true");
  marker.setAttribute("focusable", "false");
  const cross = button.ownerDocument.createElementNS(marker.namespaceURI!, "path");
  cross.setAttribute("d", "M3 3L9 9M9 3L3 9");
  marker.append(cross);
  button.append(marker);
}
