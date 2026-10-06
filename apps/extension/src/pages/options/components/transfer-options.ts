import { t } from "@browserail/i18n";

interface TransferOptions {
  includeBars: boolean;
  includeRewrites: boolean;
}

export function chooseTransferOptions(kind: "import" | "export", hasBars = true, hasRewrites = false): Promise<TransferOptions | undefined> {
  const dialog = document.createElement("dialog");
  dialog.className = "space-bookmark-dialog";
  const header = document.createElement("div");
  header.className = "space-bookmark-dialog-header";
  const title = document.createElement("span");
  title.textContent = t(kind === "import" ? "btn.import" : "btn.export");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "color-popover-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", t("common.close"));
  header.append(title, close);
  const body = document.createElement("div");
  body.className = "space-bookmark-dialog-body";
  function choice(text: string, checked: boolean, disabled: boolean): HTMLInputElement {
    const row = document.createElement("label");
    row.className = "check";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.disabled = disabled;
    row.append(input, text); body.append(row); return input;
  }
  choice(t("transfer.extensionData"), true, true);
  const bars = choice(t("transfer.barConfiguration"), false, !hasBars);
  let rewrites: HTMLInputElement | undefined;
  if (kind === "import" && hasRewrites) {
    rewrites = choice(t("transfer.rewriteDynamicBookmarks"), false, false);
    const warning = document.createElement("p");
    warning.className = "space-bookmark-help transfer-rewrite-warning";
    warning.textContent = t("transfer.rewriteWarning");
    body.append(warning);
  }
  const actions = document.createElement("div"); actions.className = "space-bookmark-dialog-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "action-btn"; cancel.textContent = t("customize.cancel");
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "save-btn"; confirm.textContent = t(kind === "import" ? "btn.import" : "btn.export");
  actions.append(confirm, cancel); body.append(actions); dialog.append(header, body); document.body.append(dialog);
  return new Promise(resolve => {
    let result: TransferOptions | undefined;
    close.addEventListener("click", () => dialog.close());
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => { result = { includeBars: bars.checked, includeRewrites: rewrites?.checked ?? false }; dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.showModal();
  });
}
