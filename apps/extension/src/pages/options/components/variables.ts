import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { EXTERNAL_DATA_STORAGE_PREFIX, listExternalData, removeExternalData } from "../../../config/external-data";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import type { OptionsState } from "../state";
import { removeIcon, setIconContent } from "./icons";
import { renderPreservingFocus } from "./render-focus";

export function mountVariables(state: OptionsState, showStatus: (message: string) => void) {
  const scope = createScope();
  const panel = element("variables-panel");
  const userList = element("user-variables");
  const list = element("external-variables");
  let revision = 0;

  function removeButton(key: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-item-btn";
    button.title = t("common.delete");
    button.ariaLabel = `${t("common.delete")} ${key}`;
    setIconContent(button, removeIcon());
    return button;
  }
  function renderUser(): void {
    renderPreservingFocus(userList, () => {
      userList.replaceChildren(...state.userVariables.map(variable => {
        const row = document.createElement("div");
        row.className = "variable-row";
        row.dataset.recordId = variable.uid;
        const key = document.createElement("input");
        key.type = "text";
        key.placeholder = key.ariaLabel = t("variables.key");
        key.value = variable.key;
        key.addEventListener("input", () => {
          state.editUserVariable(variable.uid, { key: key.value });
          remove.ariaLabel = `${t("common.delete")} ${key.value}`;
        });
        const value = document.createElement("input");
        value.type = "text";
        value.placeholder = value.ariaLabel = t("variables.value");
        value.value = typeof variable.value === "string" ? variable.value : JSON.stringify(variable.value);
        value.addEventListener("input", () => state.editUserVariable(variable.uid, { value: value.value }));
        const remove = removeButton(variable.key);
        remove.addEventListener("click", () => state.removeUserVariable(variable.uid));
        row.append(key, value, remove);
        return row;
      }));
    });
  }
  async function refreshExternal(): Promise<void> {
    const current = ++revision;
    try {
      const entries = await listExternalData();
      if (scope.signal.aborted || current !== revision) return;
      const rows = entries.map(([key, value]) => {
        const row = document.createElement("article");
        row.className = "variable-row";
        const name = document.createElement("strong");
        name.textContent = key;
        const remove = removeButton(key);
        remove.addEventListener("click", async () => {
          if (scope.signal.aborted) return;
          remove.disabled = true;
          try {
            await removeExternalData(key);
            await refreshExternal();
          } catch (error) {
            if (!scope.signal.aborted) showStatus(String(error));
            remove.disabled = false;
          }
        });
        const data = document.createElement("pre");
        data.className = "variable-value";
        data.textContent = typeof value === "string" ? value : JSON.stringify(value);
        row.append(name, data, remove);
        return row;
      });
      if (rows.length) list.replaceChildren(...rows);
      else {
        const empty = document.createElement("p");
        empty.className = "url-rule-empty-hint";
        empty.textContent = t("variables.empty");
        list.replaceChildren(empty);
      }
    } catch (error) {
      if (!scope.signal.aborted && current === revision) showStatus(String(error));
    }
  }
  element("add-variable-btn").addEventListener("click", () => {
    const uid = state.addUserVariable();
    Array.from(userList.querySelectorAll<HTMLElement>("[data-record-id]"))
      .find(row => row.dataset.recordId === uid)?.querySelector("input")?.focus();
  }, { signal: scope.signal });
  element("variables-tab").addEventListener("click", () => { void refreshExternal(); }, { signal: scope.signal });
  element("custom-bookmarks-tab").addEventListener("click", () => {
    if (!panel.hidden) void refreshExternal();
  }, { signal: scope.signal });
  const changed = (changes: Record<string, browser.Storage.StorageChange>, area: string): void => {
    if (area === "local" && !panel.hidden && Object.keys(changes).some(key => key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX)))
      void refreshExternal();
  };
  browser.storage.onChanged.addListener(changed);
  scope.add(() => browser.storage.onChanged.removeListener(changed));
  scope.add(state.subscribe(["variables"], change => { if (change.structural) renderUser(); }));
  renderUser();
  return {
    render(): void {
      renderUser();
      if (!panel.hidden) void refreshExternal();
    },
    destroy(): void {
      scope.destroy();
      userList.replaceChildren();
      list.replaceChildren();
    },
  };
}
