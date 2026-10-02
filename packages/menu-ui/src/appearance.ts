import { isAutoFontSize, type LayoutEntry, type MenuView } from "@browserail/protocol";
import type { BarState, Size } from "./types";

export function barDimensions(menu: MenuView, size: Size): Size {
  const units = menu.items.reduce((sum, item) => sum + (item.kind === "space" ? Math.max(0.1, item.units ?? 1) : 1), 0);
  const count = Math.max(1, Math.round(units));
  const gap = menu.gap ?? 4;
  return menu.orientation === "row"
    ? { width: count * size.width + (count - 1) * gap, height: size.height }
    : { width: size.width, height: count * size.height + (count - 1) * gap };
}

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
  return { buttonFontSize, popupFontSize, itemHeight };
}

function parseFontSize(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (value === "small") return 12;
  if (value === "large") return 15;
  return 13;
}

export function menuButton(
    doc: Document,
    entry: Exclude<LayoutEntry, { kind: "space" }>,
    popup: boolean,
  ): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "menu-button";
  button.toggleAttribute("data-popup", popup);
  button.title = entry.label;

  // Popup (expanded folder) buttons are colored by the menu's default color at the
  // popup level, not by the item's own color — so skip per-item color here for them.
  if (!popup && entry.color) {
    button.style.setProperty("--button-custom-color", entry.color);
    button.dataset.hasCustomColor = "true";
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
