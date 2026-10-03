import { getLanguage, helpDoc } from "@browserail/i18n";
import { element } from "../dom";
import { createScope } from "../lifecycle";

export function mountStartTab() {
  const scope = createScope();
  const startPanel = element<HTMLElement>("start-panel");

  function renderStartPanel(): void {
    // Trusted static help markup shipped in the i18n package.
    startPanel.innerHTML = helpDoc[getLanguage()];
  }
  renderStartPanel();
  return { render: renderStartPanel, destroy: scope.destroy };
}
