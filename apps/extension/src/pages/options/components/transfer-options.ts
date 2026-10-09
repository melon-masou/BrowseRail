import { t } from "@browserail/i18n";
import type { ExportedSettingsData } from "@browserail/protocol";
import { normalizeDynamicBookmarks } from "../../../config";
import { hasTransferGroup, transferCounts, transferGroups, type TransferGroup, type TransferOptions } from "../transfer";

export function chooseTransferOptions(kind: "import" | "export" | "cloudDownload", data: ExportedSettingsData): Promise<TransferOptions | undefined> {
  const action = kind === "cloudDownload" ? "cloud.download" : kind === "import" ? "btn.import" : "btn.export";
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
  function choice(text: string, checked: boolean, disabled: boolean): HTMLInputElement {
    const row = document.createElement("label");
    row.className = "check";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked; input.disabled = disabled;
    row.append(input, text); body.append(row); return input;
  }
  const counts = transferCounts(data);
  const inputs = new Map<TransferGroup, HTMLInputElement>();
  const labels = { menus: "section.menus", urlRules: "section.urlRules", bookmarks: "section.customBookmarks", shortcuts: "section.shortcuts", bars: "transfer.barConfiguration" } as const;
  if (kind === "cloudDownload") {
    const message = document.createElement("p");
    message.textContent = t("cloud.downloadConfirm");
    body.append(message);
  } else {
    for (const group of transferGroups) {
      const available = hasTransferGroup(data, group);
      inputs.set(group, choice(`${t(labels[group])} (${counts[group]})`, available, !available));
    }
  }
  let rewrites: HTMLInputElement | undefined;
  if (kind !== "export" && normalizeDynamicBookmarks(data.dynamicBookmarks).some(db => db.type === "rewrite")) {
    rewrites = choice(t("transfer.rewriteDynamicBookmarks"), false, false);
    const warning = document.createElement("p");
    warning.className = "space-bookmark-help transfer-rewrite-warning";
    warning.textContent = t("transfer.rewriteWarning");
    body.append(warning);
    const bookmarks = inputs.get("bookmarks");
    if (bookmarks) {
      const update = () => { rewrites!.disabled = !bookmarks.checked; warning.hidden = !bookmarks.checked; };
      bookmarks.addEventListener("change", update);
      update();
    }
  }
  const actions = document.createElement("div"); actions.className = "space-bookmark-dialog-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "action-btn"; cancel.textContent = t("customize.cancel");
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "save-btn"; confirm.textContent = t(action);
  const updateConfirm = () => { confirm.disabled = kind !== "cloudDownload" && ![...inputs.values()].some(input => input.checked); };
  for (const input of inputs.values()) input.addEventListener("change", updateConfirm);
  updateConfirm();
  actions.append(confirm, cancel); body.append(actions); dialog.append(header, body); document.body.append(dialog);
  return new Promise(resolve => {
    let result: TransferOptions | undefined;
    close.addEventListener("click", () => dialog.close());
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => { result = {
      menus: inputs.get("menus")?.checked ?? true,
      urlRules: inputs.get("urlRules")?.checked ?? true,
      bookmarks: inputs.get("bookmarks")?.checked ?? true,
      shortcuts: inputs.get("shortcuts")?.checked ?? true,
      bars: inputs.get("bars")?.checked ?? false,
      includeRewrites: rewrites?.checked ?? false,
    }; dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.showModal();
  });
}
