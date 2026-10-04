const SVG_NS = "http://www.w3.org/2000/svg";
type Shape = readonly [tag: string, attributes: Record<string, string>];

function icon(attributes: Record<string, string>, shapes: readonly Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", ...attributes })) {
    svg.setAttribute(name, value);
  }
  for (const [tag, shapeAttributes] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(shapeAttributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

export const settingsIcon = (): SVGSVGElement => icon({ width: "13", height: "13", "stroke-width": "2" }, [
  ["path", { d: "M12 15a3 3 0 100-6 3 3 0 000 6z" }],
  ["path", { d: "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" }],
]);

export const removeIcon = (): SVGSVGElement => icon({ width: "12", height: "12", "stroke-width": "2.5", "stroke-linecap": "round" }, [
  ["line", { x1: "4", y1: "12", x2: "20", y2: "12" }],
]);

export const addIcon = (): SVGSVGElement => icon({ width: "12", height: "12", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
  ["line", { x1: "12", y1: "5", x2: "12", y2: "19" }],
  ["line", { x1: "5", y1: "12", x2: "19", y2: "12" }],
]);

export const copyIcon = (): SVGSVGElement => icon({ class: "dynamic-current-icon", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
  ["rect", { x: "9", y: "9", width: "13", height: "13", rx: "2", ry: "2" }],
  ["path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }],
]);

export const checkIcon = (): SVGSVGElement => icon({ class: "dynamic-current-icon", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
  ["polyline", { points: "20 6 9 17 4 12" }],
]);

export function setIconContent(target: Element, svg: SVGSVGElement, label?: string, labelClass?: string): HTMLSpanElement | undefined {
  if (label === undefined) {
    target.replaceChildren(svg);
    return undefined;
  }
  const span = document.createElement("span");
  if (labelClass) span.className = labelClass;
  span.textContent = label;
  target.replaceChildren(svg, span);
  return span;
}
