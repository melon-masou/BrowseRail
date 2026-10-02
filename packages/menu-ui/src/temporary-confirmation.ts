import { t } from "@browserail/i18n";

export function mountTemporaryConfirmation(root: HTMLElement, host: {
  save(note: string): Promise<void>;
  close(): Promise<void>;
}) {
  const doc = root.ownerDocument;
  const lifetime = new AbortController();
  const form = doc.createElement("form");
  form.className = "temporary-confirm-form";
  const heading = doc.createElement("h1");
  heading.textContent = t("temporary.confirmTitle");
  const label = doc.createElement("label");
  label.textContent = t("temporary.noteLabel");
  const input = doc.createElement("input");
  input.type = "text";
  input.maxLength = 80;
  label.append(input);
  const status = doc.createElement("p");
  status.className = "temporary-confirm-status";
  status.setAttribute("role", "alert");
  const actions = doc.createElement("div");
  actions.className = "temporary-confirm-actions";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("customize.cancel");
  const save = doc.createElement("button");
  save.type = "submit";
  save.textContent = t("btn.save");
  actions.append(cancel, save);
  form.append(heading, label, status, actions);
  root.replaceChildren(form);

  function report(error: unknown): void {
    if (!lifetime.signal.aborted) status.textContent = t("status.saveFailed", { error: String(error) });
  }
  const close = (): void => { void host.close().catch(report); };
  cancel.addEventListener("click", close, { signal: lifetime.signal });
  doc.defaultView?.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
  }, { signal: lifetime.signal });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    status.textContent = "";
    void host.save(input.value.trim()).then(() => host.close()).catch(error => {
      report(error);
      save.disabled = false;
    });
  }, { signal: lifetime.signal });
  return {
    focus(): void { input.focus(); },
    destroy(): void { lifetime.abort(); form.remove(); },
  };
}
