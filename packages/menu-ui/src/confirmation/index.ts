import { t } from "@browserail/i18n";

export function mountTemporaryConfirmation(root: HTMLElement, host: {
  save(note: string): Promise<void>;
  close(): Promise<void>;
}) {
  return mountBookmarkConfirmation(root, {
    title: t("temporary.confirmTitle"),
    fields: [{ key: "note", label: t("temporary.noteLabel"), maxLength: 80 }],
    save: values => host.save(values.note!),
    close: () => host.close(),
  });
}

export function mountBookmarkConfirmation(root: HTMLElement, host: {
  title: string;
  fields: Array<{ key: string; label: string; value?: string; required?: boolean; maxLength?: number; inputMode?: string }>;
  save(values: Record<string, string>): Promise<void>;
  close(): Promise<void>;
}) {
  const doc = root.ownerDocument;
  const lifetime = new AbortController();
  const form = doc.createElement("form");
  form.className = "temporary-confirm-form";
  const heading = doc.createElement("h1");
  heading.textContent = host.title;
  const inputs = host.fields.map(field => {
    const label = doc.createElement("label");
    label.textContent = field.label;
    const input = doc.createElement("input");
    input.type = "text";
    input.name = field.key;
    input.value = field.value ?? "";
    input.required = field.required ?? false;
    if (field.maxLength !== undefined) input.maxLength = field.maxLength;
    if (field.inputMode) input.inputMode = field.inputMode;
    label.append(input);
    return { key: field.key, input, label };
  });
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
  form.append(heading, ...inputs.map(field => field.label), status, actions);
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
    if (save.disabled || !form.reportValidity()) return;
    save.disabled = true;
    status.textContent = "";
    const values = Object.fromEntries(inputs.map(field => [field.key, field.input.value.trim()]));
    void host.save(values).then(() => host.close()).catch(error => {
      report(error);
      save.disabled = false;
    });
  }, { signal: lifetime.signal });
  return {
    focus(): void { inputs[0]?.input.focus(); },
    destroy(): void { lifetime.abort(); form.remove(); },
  };
}
