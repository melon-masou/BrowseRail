import { t } from "@browserail/i18n";

export function createMoveButtons(index: number, count: number, move: (step: -1 | 1) => void): HTMLElement {
  const controls = document.createElement("span");
  controls.className = "move-item-buttons";
  for (const step of [-1, 1] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "move-item-btn";
    button.title = button.ariaLabel = t(step === -1 ? "item.moveUp" : "item.moveDown");
    button.disabled = step === -1 ? index === 0 : index === count - 1;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", step === -1 ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6");
    svg.append(path); button.append(svg);
    button.addEventListener("click", () => move(step));
    controls.append(button);
  }
  return controls;
}
