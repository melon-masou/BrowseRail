import { t } from "@browserail/i18n";
import type { ExportedSettingsData } from "@browserail/protocol";
import { normalizeDynamicBookmarks } from "../../../config";
import { hasTransferGroup, transferCounts, transferGroups, type ImportMode, type TransferGroup, type TransferOptions } from "../transfer";

export function chooseTransferOptions(kind: "import" | "export", data: ExportedSettingsData): Promise<TransferOptions | undefined> {
  const action = kind === "import" ? "btn.import" : "btn.export";
  const dialog = document.createElement("dialog");
  dialog.className = "space-bookmark-dialog";
  const header = document.createElement("div");
  header.className = "space-bookmark-dialog-header";
  const title = document.createElement("span");
  title.textContent = t(action);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "color-popover-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", t("common.close"));
  header.append(title, close);
  const body = document.createElement("div");
  body.className = "space-bookmark-dialog-body";
  const choices = createTransferChoices(data, kind !== "export");
  body.append(choices.element);
  const actions = document.createElement("div"); actions.className = "space-bookmark-dialog-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "action-btn"; cancel.textContent = t("customize.cancel");
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "save-btn"; confirm.textContent = t(action);
  const updateConfirm = () => { confirm.disabled = !choices.hasSelection(); };
  choices.element.addEventListener("change", updateConfirm);
  updateConfirm();
  actions.append(confirm, cancel); body.append(actions); dialog.append(header, body); document.body.append(dialog);
  return new Promise(resolve => {
    let result: TransferOptions | undefined;
    close.addEventListener("click", () => dialog.close());
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => { result = choices.options(); dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.showModal();
  });
}

export function createTransferChoices(data: ExportedSettingsData, importing: boolean, selection?: Partial<TransferOptions>) {
  const element = document.createElement("div");
  element.className = "transfer-choices";
  let mode = selection?.mode ?? "merge";
  const counts = transferCounts(data);
  const inputs = new Map<TransferGroup, HTMLInputElement>();
  const labels = { menus: "section.menus", urlRules: "section.urlRules", bookmarks: "section.customBookmarks", shortcuts: "section.shortcuts", bars: "transfer.barConfiguration" } as const;
  function choice(text: string, checked: boolean, disabled = false): HTMLInputElement {
    const row = document.createElement("label"); row.className = "check";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.disabled = disabled;
    row.append(input, text); element.append(row); return input;
  }
  for (const group of transferGroups) {
    const available = hasTransferGroup(data, group);
    const input = choice(`${t(labels[group])} (${counts[group]})`, available && (selection?.[group] ?? true), !available);
    input.dataset.transferGroup = group;
    inputs.set(group, input);
  }
  let rewrites: HTMLInputElement | undefined;
  if (importing && normalizeDynamicBookmarks(data.dynamicBookmarks).some(db => db.type === "rewrite")) {
    rewrites = choice(t("transfer.rewriteDynamicBookmarks"), false);
    const warning = document.createElement("p");
    warning.className = "space-bookmark-help transfer-rewrite-warning";
    warning.textContent = t("transfer.rewriteWarning");
    element.append(warning);
    const update = () => { rewrites!.disabled = !inputs.get("bookmarks")!.checked; warning.hidden = rewrites!.disabled; };
    inputs.get("bookmarks")!.addEventListener("change", update);
    update();
  }
  if (importing) {
    const modes = document.createElement("div");
    modes.className = "shortcuts-subtabs transfer-mode";
    modes.setAttribute("role", "group");
    modes.ariaLabel = t("transfer.mode");
    const buttons = new Map<ImportMode, HTMLButtonElement>();
    const render = () => {
      for (const [value, button] of buttons) {
        button.classList.toggle("is-active", value === mode);
        button.setAttribute("aria-pressed", String(value === mode));
      }
    };
    for (const value of ["merge", "replace"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shortcuts-subtab-btn";
      button.textContent = t(value === "merge" ? "transfer.merge" : "transfer.replace");
      button.addEventListener("click", () => { mode = value; render(); });
      buttons.set(value, button); modes.append(button);
    }
    render(); element.append(modes);
  }
  return {
    element,
    hasSelection: () => [...inputs.values()].some(input => input.checked),
    options: (): TransferOptions => ({
      menus: inputs.get("menus")!.checked,
      urlRules: inputs.get("urlRules")!.checked,
      bookmarks: inputs.get("bookmarks")!.checked,
      shortcuts: inputs.get("shortcuts")!.checked,
      bars: inputs.get("bars")!.checked,
      includeRewrites: !!rewrites?.checked && !rewrites.disabled,
      ...(importing ? { mode } : {}),
    }),
  };
}
