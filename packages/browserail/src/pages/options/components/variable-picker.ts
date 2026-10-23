import { t } from "@browserail/i18n";
import { listExternalData } from "../../../lib/config/external-data";
import type { VariableSource } from "../../../lib/bookmarks/variables";
import { createScope } from "../lifecycle";
import type { OptionsState } from "../state";
import { createItemPicker } from "./item-picker";
import { positionPopover } from "./popover-position";

export function createVariablePicker(state: OptionsState, showStatus: (message: string) => void) {
  const scope = createScope();
  const picker = createItemPicker();
  const dropdown = document.createElement("div");
  dropdown.className = "add-item-popover variable-source-popover";
  dropdown.style.display = "none";
  document.body.append(dropdown);
  let anchor: HTMLElement | undefined;
  let revision = 0;

  function closeDropdown(): void {
    dropdown.style.display = "none";
    anchor = undefined;
  }
  document.addEventListener("click", event => {
    if (event.target instanceof Node && !dropdown.contains(event.target) && !anchor?.contains(event.target)) closeDropdown();
  }, { signal: scope.signal });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && anchor) {
      anchor.focus();
      closeDropdown();
    }
  }, { signal: scope.signal });
  window.addEventListener("scroll", closeDropdown, { capture: true, signal: scope.signal });
  window.addEventListener("resize", closeDropdown, { signal: scope.signal });

  return {
    open(button: HTMLElement, onPick: (source: VariableSource, key: string) => void): void {
      if (scope.signal.aborted) return;
      ++revision;
      picker.close();
      if (anchor === button) {
        closeDropdown();
        return;
      }
      closeDropdown();
      anchor = button;
      dropdown.replaceChildren();
      for (const source of ["user", "external"] as const) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = "add-popover-item";
        const label = t(source === "user" ? "variables.user" : "variables.external");
        choice.textContent = label;
        choice.addEventListener("click", async () => {
          closeDropdown();
          const current = ++revision;
          try {
            const keys = source === "user" ? Object.keys(state.settings.userVariables) : (await listExternalData()).map(([key]) => key);
            if (scope.signal.aborted || current !== revision) return;
            const key = await picker.pick(label, keys.filter(key => !/[{}]/.test(key)).map(key => ({ id: key, label: key })), t("variables.noVariables"));
            if (key !== null && !scope.signal.aborted && current === revision) onPick(source, key);
          } catch (error) {
            if (!scope.signal.aborted && current === revision) showStatus(String(error));
          }
        });
        dropdown.append(choice);
      }
      positionPopover(dropdown, button.getBoundingClientRect(), 170, "right");
    },
    destroy(): void {
      ++revision;
      scope.destroy();
      picker.destroy();
      dropdown.remove();
    },
  };
}
