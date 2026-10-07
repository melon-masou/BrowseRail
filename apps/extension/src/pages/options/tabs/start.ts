import { getLanguage, helpDoc } from "@browserail/i18n";
import { element } from "../dom";
import { createScope } from "../lifecycle";

export function mountStartTab() {
  const scope = createScope();
  const startPanel = element<HTMLElement>("start-panel");

  function renderStartPanel(): void {
    const content = document.createElement("div");
    content.className = "help-doc";
    for (const section of helpDoc[getLanguage()]) {
      const title = document.createElement("h2");
      title.textContent = section.title;
      const list = document.createElement("ul");
      for (const item of section.items) {
        const row = document.createElement("li");
        if (typeof item === "string") row.textContent = item;
        else {
          const label = document.createElement("strong");
          label.textContent = item.label;
          row.append(label, item.text);
        }
        list.append(row);
      }
      content.append(title, list);
    }
    startPanel.replaceChildren(content);
  }
  renderStartPanel();
  return { render: renderStartPanel, destroy: scope.destroy };
}
