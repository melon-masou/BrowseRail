import { t } from "@browserail/i18n";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showWindowWhenReady } from "./window-ready";

export function initializeTemporaryConfirmation(root: HTMLElement): void {
  document.body.dataset.view = "temporary-confirm";
  const query = new URLSearchParams(location.search);
  const instanceUid = query.get("instanceUid") ?? "";
  const menuUid = query.get("menuUid") ?? "";
  const windowUid = query.get("windowUid") ?? "";
  const uid = query.get("uid") ?? "";

  const form = document.createElement("form");
  form.className = "listener-settings temporary-confirm-form";
  const heading = document.createElement("h1");
  heading.textContent = t("temporary.confirmTitle");
  const message = document.createElement("p");
  message.textContent = t("temporary.saveConfirm");
  const noteLabel = document.createElement("label");
  noteLabel.className = "settings-label";
  noteLabel.textContent = t("temporary.noteLabel");
  const noteInput = document.createElement("input");
  noteInput.type = "text";
  noteInput.maxLength = 80;
  noteInput.placeholder = t("temporary.notePlaceholder");
  noteLabel.appendChild(noteInput);
  const status = document.createElement("p");
  status.className = "temporary-confirm-status";
  const actions = document.createElement("div");
  actions.className = "temporary-confirm-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("customize.cancel");
  cancel.addEventListener("click", () => { void getCurrentWindow().close(); });
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = t("btn.save");
  actions.append(cancel, save);
  form.append(heading, message, noteLabel, status, actions);
  root.replaceChildren(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!instanceUid || !menuUid || !uid) return;
    save.disabled = true;
    const params = new URLSearchParams({ confirmed: "1", note: noteInput.value.trim() });
    const actionUid = `temporarySave:${encodeURIComponent(uid)}?${params}`;
    const command = windowUid ? "invoke_action" : "invoke_free_action";
    const args = windowUid
      ? { actionUid, instanceUid, windowUid }
      : { actionUid, instanceUid, menuUid };
    void invoke(command, args).then(() => getCurrentWindow().close()).catch((error: unknown) => {
      status.textContent = t("status.saveFailed", { error: String(error) });
      save.disabled = false;
    });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") void getCurrentWindow().close();
  });
  void showWindowWhenReady().then(() => noteInput.focus());
}
