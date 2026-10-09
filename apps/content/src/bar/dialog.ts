import { t } from "@browserail/i18n";

export interface DialogField {
  label: string;
  value: string;
  placeholder?: string;
  number?: { min: number; max: number };
  choices?: Array<{ value: string; label: string }>;
}

export function openDialog(container: HTMLElement, signal: AbortSignal, title: string, fields: DialogField[], hint?: string): Promise<string[] | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  const doc = container.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  const overlay = doc.createElement("div");
  overlay.className = "dialog-overlay";
  const form = doc.createElement("form");
  form.className = "host-dialog";
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-modal", "true");
  form.setAttribute("aria-label", title);
  const heading = doc.createElement("h2");
  heading.textContent = title;
  form.append(heading);
  if (hint) { const text = doc.createElement("p"); text.textContent = hint; form.append(text); }
  const inputs = fields.map(field => {
    const label = doc.createElement("label");
    const caption = doc.createElement("span");
    caption.textContent = field.label;
    const input = doc.createElement(field.choices ? "select" : "input");
    if (input instanceof HTMLSelectElement) {
      for (const choice of field.choices!) {
        const option = doc.createElement("option");
        option.value = choice.value; option.textContent = choice.label;
        input.append(option);
      }
    } else {
      input.type = field.number ? "number" : "text";
      input.placeholder = field.placeholder ?? "";
      if (field.number) { input.min = String(field.number.min); input.max = String(field.number.max); input.step = "any"; input.required = true; }
    }
    input.value = field.value;
    label.append(caption, input); form.append(label);
    return input;
  });
  const actions = doc.createElement("div"); actions.className = "dialog-actions";
  const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = t("customize.cancel");
  const save = doc.createElement("button"); save.type = "submit"; save.textContent = t("btn.save");
  actions.append(cancel, save); form.append(actions); overlay.append(form); container.append(overlay);
  return new Promise(resolve => {
    const events = new AbortController();
    let finished = false;
    const finish = (values?: string[]): void => {
      if (finished) return;
      finished = true;
      events.abort();
      signal.removeEventListener("abort", aborted);
      overlay.remove();
      previous?.focus({ preventScroll: true });
      resolve(values);
    };
    const aborted = (): void => finish();
    signal.addEventListener("abort", aborted, { once: true });
    cancel.addEventListener("click", () => finish(), { signal: events.signal });
    form.addEventListener("submit", event => { event.preventDefault(); if (form.reportValidity()) finish(inputs.map(input => input.value)); }, { signal: events.signal });
    overlay.addEventListener("pointerdown", event => { if (event.target === overlay) finish(); event.stopPropagation(); }, { signal: events.signal });
    doc.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); finish(); }
      else if (event.key === "Tab") {
        const focusable = [...inputs, cancel, save];
        const current = container.getRootNode() instanceof ShadowRoot ? (container.getRootNode() as ShadowRoot).activeElement : doc.activeElement;
        const index = focusable.indexOf(current as HTMLInputElement);
        event.preventDefault(); event.stopImmediatePropagation();
        focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]!.focus();
      }
    }, { capture: true, signal: events.signal });
    (inputs[0] ?? cancel).focus({ preventScroll: true });
  });
}
