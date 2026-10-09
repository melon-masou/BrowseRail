import { t } from "@browserail/i18n";
import { addIcon, removeIcon } from "./icons";

interface GlobalCssEditor {
  read(): Readonly<Record<string, string>>;
  add(name: string): string | undefined;
  update(key: string, css: string): void;
  remove(key: string): void;
}

export function createCssEditor(closed: () => void) {
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const dialog = document.createElement("dialog");
  dialog.className = "menu-settings-dialog css-editor-dialog";
  const header = document.createElement("div"); header.className = "menu-settings-dialog-header";
  const title = document.createElement("span");
  const close = document.createElement("button"); close.type = "button"; close.className = "color-popover-close";
  close.textContent = "✕"; close.ariaLabel = t("common.close");
  header.append(title, close);
  const body = document.createElement("div"); body.className = "menu-settings-dialog-body";
  const toolbar = document.createElement("div"); toolbar.className = "css-editor-toolbar"; toolbar.hidden = true;
  const select = document.createElement("select"); select.ariaLabel = t("css.global");
  const add = document.createElement("button"); add.type = "button"; add.className = "menu-action-btn css-editor-add";
  add.ariaLabel = t("toolkit.add"); add.title = t("toolkit.add"); add.append(addIcon());
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-item-btn";
  remove.ariaLabel = t("menu.remove"); remove.title = t("menu.remove"); remove.append(removeIcon());
  toolbar.append(select, add, remove);
  const input = document.createElement("textarea"); input.spellcheck = false; input.wrap = "off";
  input.className = "css-editor-input"; input.ariaLabel = "CSS";
  body.append(toolbar, input); dialog.append(header, body); document.body.append(dialog);
  const nameDialog = document.createElement("dialog"); nameDialog.className = "space-bookmark-dialog";
  nameDialog.ariaLabel = t("css.name");
  const nameHeader = document.createElement("div"); nameHeader.className = "space-bookmark-dialog-header"; nameHeader.textContent = t("css.name");
  const nameForm = document.createElement("form"); nameForm.className = "space-bookmark-dialog-body";
  const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.required = true; nameInput.spellcheck = false; nameInput.ariaLabel = t("css.name");
  const nameActions = document.createElement("div"); nameActions.className = "space-bookmark-dialog-actions";
  const confirm = document.createElement("button"); confirm.type = "submit"; confirm.className = "save-btn"; confirm.textContent = t("toolkit.add");
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "action-btn"; cancel.textContent = t("customize.cancel");
  nameActions.append(confirm, cancel); nameForm.append(nameInput, nameActions);
  nameDialog.append(nameHeader, nameForm); document.body.append(nameDialog);
  let collection: GlobalCssEditor | undefined;
  let selectedKey: string | undefined;
  function renderCollection(): void {
    if (!collection) return;
    const styles = collection.read();
    const keys = Object.keys(styles).sort();
    if (selectedKey === undefined || !Object.hasOwn(styles, selectedKey)) selectedKey = keys[0];
    select.replaceChildren(...keys.map(key => {
      const option = document.createElement("option"); option.value = key; option.textContent = key; return option;
    }));
    select.value = selectedKey ?? "";
    input.value = selectedKey === undefined ? "" : styles[selectedKey]!;
    select.disabled = input.disabled = remove.disabled = selectedKey === undefined;
  }
  input.addEventListener("input", () => {
    if (selectedKey !== undefined) collection?.update(selectedKey, input.value);
  }, options);
  select.addEventListener("change", () => { selectedKey = select.value; renderCollection(); }, options);
  add.addEventListener("click", () => {
    if (!collection) return;
    nameInput.value = ""; nameInput.setCustomValidity(""); nameDialog.showModal(); nameInput.focus();
  }, options);
  nameInput.addEventListener("input", () => nameInput.setCustomValidity(""), options);
  nameForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!collection) return;
    const key = collection.add(nameInput.value);
    if (key === undefined) {
      nameInput.setCustomValidity(t("css.invalidKey")); nameInput.reportValidity(); return;
    }
    selectedKey = key; renderCollection(); nameDialog.close(); input.focus();
  }, options);
  cancel.addEventListener("click", () => nameDialog.close(), options);
  remove.addEventListener("click", () => {
    if (!collection || selectedKey === undefined) return;
    collection.remove(selectedKey); renderCollection();
  }, options);
  close.addEventListener("click", () => dialog.close(), options);
  dialog.addEventListener("close", () => { collection = undefined; closed(); }, options);
  return {
    get isOpen(): boolean { return dialog.open; },
    openGlobal(actions: GlobalCssEditor): void {
      title.textContent = t("css.global"); dialog.ariaLabel = t("css.global");
      collection = actions; toolbar.hidden = false;
      renderCollection(); dialog.showModal();
      if (input.disabled) add.focus(); else input.focus();
    },
    destroy(): void { lifetime.abort(); collection = undefined; nameDialog.remove(); dialog.remove(); },
  };
}
