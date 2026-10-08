import { t } from "@browserail/i18n";
import { DEFAULT_DOCK_COLOR, type MenuAnchor, type MenuOrientation } from "@browserail/protocol";
import { applyBarTheme, menuButton } from "../appearance";
import { applyBarLayout } from "../layout";
import type { BarState, Rect } from "../types";
import { placeCustomizationToolbar, type ToolbarSide } from "./customization-position";
import { applyBarHiddenAppearance } from "./hidden-area";

export function layoutCustomization(content: HTMLElement, rail: HTMLElement, toolbar: HTMLElement, anchor: Rect, bounds: Rect, current?: ToolbarSide) {
  const position = placeCustomizationToolbar(anchor, toolbar.getBoundingClientRect(), bounds, current, 4,
    rail.dataset.orientation === "column" ? "left" : "center");
  const envelope = position.bounds;
  content.style.width = `${envelope.right - envelope.left}px`;
  content.style.height = `${envelope.bottom - envelope.top}px`;
  // The rail's margins contain its frame; anchor describes that whole surface.
  rail.style.left = `${anchor.left - envelope.left}px`;
  rail.style.top = `${anchor.top - envelope.top}px`;
  toolbar.style.left = `${position.x - envelope.left}px`;
  toolbar.style.top = `${position.y - envelope.top}px`;
  return position;
}

export function createCustomizationRail(root: HTMLElement, state: BarState): HTMLElement {
  const doc = root.ownerDocument;
  const menu = state.menu;
  const theme = applyBarTheme(root, state);
  const railContainer = doc.createElement("div");
  railContainer.className = "menu-bar is-editing";
  if (menu.cssClass?.trim()) railContainer.classList.add(...menu.cssClass.trim().split(/\s+/));
  railContainer.dataset.orientation = menu.orientation;
  railContainer.style.setProperty("--config-bar-font-size", `${theme.buttonFontSize}px`);
  railContainer.style.setProperty("--config-bar-background", menu.dockColor || DEFAULT_DOCK_COLOR);

  if (menu.items.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "empty-menu";
    empty.textContent = t("menu.empty");
    railContainer.replaceChildren(empty);
  } else {
    railContainer.replaceChildren(...menu.items.map(entry => menuButton(doc, entry, false)));
  }

  applyBarLayout(railContainer, menu, state.itemSize);
  applyBarHiddenAppearance(railContainer, menu, state.itemSize, false);
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

export function createOrientationControl(doc: Document, initial: MenuOrientation, changed: (orientation: MenuOrientation) => void) {
  let orientation = initial;
  const button = controlButton(doc, "");
  function render(): void {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("fill", "currentColor");
    for (let i = 0; i < 3; i++) {
      const rect = doc.createElementNS(svg.namespaceURI, "rect");
      const row = orientation === "row";
      rect.setAttribute("x", String(row ? 2 + i * 4.5 : 2));
      rect.setAttribute("y", String(row ? 2 : 2 + i * 4.5));
      rect.setAttribute("width", row ? "3" : "12"); rect.setAttribute("height", row ? "12" : "3");
      rect.setAttribute("rx", "1"); svg.append(rect);
    }
    button.replaceChildren(svg);
    button.title = `${t("menuSettings.direction")}: ${t(orientation === "row" ? "menuSettings.row" : "menuSettings.column")}`;
    button.ariaLabel = button.title;
  }
  button.addEventListener("click", () => { changed(orientation === "row" ? "column" : "row"); });
  render();
  return {
    button,
    update(value: MenuOrientation): void { if (orientation !== value) { orientation = value; render(); } },
  };
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

export function createSpacingIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  const path = doc.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M3 4v16M21 4v16M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3");
  svg.append(path);
  return svg;
}
