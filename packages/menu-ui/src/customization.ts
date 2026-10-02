import { t } from "@browserail/i18n";
import type { MenuAnchor } from "@browserail/protocol";
import { applyBarTheme, menuButton } from "./appearance";
import type { BarState } from "./types";

export function createCustomizationRail(root: HTMLElement, state: BarState): HTMLElement {
  const doc = root.ownerDocument;
  const menu = state.menu;
  const theme = applyBarTheme(root, state);
  const DEFAULT_DOCK_COLOR = "#161b24";
  const gap = menu.gap ?? 4;
  const railContainer = doc.createElement("div");
  railContainer.className = "customize-rail";
  railContainer.dataset.orientation = menu.orientation;
  const totalUnits = menu.items.reduce((sum, entry) => sum + (entry.kind === "space" ? Math.max(0.1, entry.units ?? 1) : 1), 0);
  railContainer.style.setProperty("--item-count", String(Math.max(1, Math.round(totalUnits))));
  railContainer.style.setProperty("--menu-gap", `${gap}px`);
  railContainer.style.setProperty("--button-font-size", `${theme.buttonFontSize}px`);
  const opacity = typeof menu.opacity === "number" ? Math.max(0, Math.min(100, menu.opacity)) : 88;
  const baseColor = menu.dockColor || DEFAULT_DOCK_COLOR;
  railContainer.style.setProperty("--menu-bar-bg", `color-mix(in srgb, ${baseColor} ${opacity}%, transparent)`);

  if (menu.items.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "empty-menu";
    empty.textContent = t("menu.empty");
    railContainer.replaceChildren(empty);
  } else {
    railContainer.replaceChildren(...menu.items.map(entry => {
      if (entry.kind !== "space") return menuButton(doc, entry, false);
      const space = doc.createElement("div");
      space.className = "menu-space";
      space.style.setProperty("--space-units", String(Math.max(0.1, entry.units ?? 1)));
      space.dataset.transparent = String(entry.transparent !== false);
      if (entry.transparent !== false) space.style.backgroundColor = "transparent";
      else if (entry.color) space.style.backgroundColor = entry.color;
      else space.classList.add("menu-space-solid");
      return space;
    }));
  }

  return railContainer;
}

export function controlButton(doc: Document, content: string | Element): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "customize-control";
  if (typeof content === "string") {
    button.textContent = content;
  } else {
    button.append(content);
  }
  return button;
}

export function createAnchorIcon(doc: Document, anchor: MenuAnchor): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");

  const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "1.5");
  rect.setAttribute("y", "1.5");
  rect.setAttribute("width", "13");
  rect.setAttribute("height", "13");
  rect.setAttribute("rx", "2.5");
  rect.setAttribute("stroke", "currentColor");
  rect.setAttribute("stroke-width", "1.3");
  rect.setAttribute("stroke-opacity", "0.6");

  const dot = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
  let cx = "4.5";
  let cy = "4.5";
  switch (anchor) {
    case "topLeft":
      cx = "4.5";
      cy = "4.5";
      break;
    case "topRight":
      cx = "11.5";
      cy = "4.5";
      break;
    case "bottomRight":
      cx = "11.5";
      cy = "11.5";
      break;
    case "bottomLeft":
      cx = "4.5";
      cy = "11.5";
      break;
  }
  dot.setAttribute("cx", cx);
  dot.setAttribute("cy", cy);
  dot.setAttribute("r", "2.2");
  dot.setAttribute("fill", "#7aa2ff");

  svg.append(rect, dot);
  return svg;
}

export function createMoveIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20",
  );
  svg.append(path);
  return svg;
}

export function createSaveIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#34d399");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const polyline = doc.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "20 6 9 17 4 12");
  svg.append(polyline);
  return svg;
}

export function createCancelIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#f87171");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const line1 = doc.createElementNS("http://www.w3.org/2000/svg", "line");
  line1.setAttribute("x1", "18");
  line1.setAttribute("y1", "6");
  line1.setAttribute("x2", "6");
  line1.setAttribute("y2", "18");

  const line2 = doc.createElementNS("http://www.w3.org/2000/svg", "line");
  line2.setAttribute("x1", "6");
  line2.setAttribute("y1", "6");
  line2.setAttribute("x2", "18");
  line2.setAttribute("y2", "18");

  svg.append(line1, line2);
  return svg;
}

export function nextAnchor(anchor: MenuAnchor): MenuAnchor {
  const anchors: MenuAnchor[] = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  return anchors[(anchors.indexOf(anchor) + 1) % anchors.length]!;
}

export function anchorLabel(anchor: MenuAnchor): string {
  return { topLeft: "TL", topRight: "TR", bottomLeft: "BL", bottomRight: "BR" }[anchor];
}
