import { t } from "@browserail/i18n";
import { ALL_URLS_RULE_UID, DEFAULT_EXTERNAL_EVENT_NAME, type ExternalAction } from "@browserail/protocol";
import type { OptionsState, ReadonlyData } from "../state";
import { removeIcon, setIconContent } from "./icons";

/** Extensions receive parsed JSON; empty data is valid and sends null. */
export function isValidExternalActionData(data: string | undefined): boolean {
  if (!data?.trim()) return true;
  try { JSON.parse(data); return true; } catch { return false; }
}

/** The first reason an action cannot be saved, or undefined when it is complete. */
export function externalActionSaveError(action: ReadonlyData<ExternalAction>, ruleUids: ReadonlySet<string>): string | undefined {
  const name = action.name || t("externalAction.defaultName");
  if (!action.urlRuleUid || (action.urlRuleUid !== ALL_URLS_RULE_UID && !ruleUids.has(action.urlRuleUid)))
    return t("externalAction.saveNeedsRule", { name });
  if (action.target === "extension" ? !action.extensionId : !action.eventName) return t("externalAction.saveNeedsTarget", { name });
  if (action.target === "extension" && !isValidExternalActionData(action.data)) return t("externalAction.saveInvalidData", { name });
  return undefined;
}

export function createExternalAction(): ExternalAction {
  return { uid: crypto.randomUUID(), name: t("externalAction.defaultName"), target: "event", eventName: DEFAULT_EXTERNAL_EVENT_NAME };
}

export function createExternalActionsList(state: OptionsState, list: HTMLElement, remove: (uid: string) => void) {
  // Like dynamic bookmarks: existing and imported actions start collapsed; one just added opens.
  const seen = new Set(state.settings.externalActions.map(action => action.uid));
  const collapsed = new Set(seen);
  let added: string | undefined;

  function field(labelText: string, control: HTMLElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "dynamic-field";
    const text = document.createElement("span");
    text.className = "dynamic-field-label";
    text.textContent = labelText;
    label.append(text, control);
    return label;
  }

  function textInput(value: string | undefined, placeholder: string, change: (value: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.placeholder = placeholder;
    input.addEventListener("input", () => change(input.value.trim()));
    return input;
  }

  function renderCard(action: ReadonlyData<ExternalAction>): HTMLElement {
    if (!seen.has(action.uid)) {
      seen.add(action.uid);
      if (action.uid !== added) collapsed.add(action.uid);
    }
    const isCollapsed = collapsed.has(action.uid);
    const card = document.createElement("article");
    card.className = `menu-card dynamic-card external-action-card${isCollapsed ? " is-collapsed" : ""}`;
    card.dataset.collapsed = String(isCollapsed);
    card.dataset.recordId = action.uid;

    const header = document.createElement("header");
    const titleRow = document.createElement("div");
    titleRow.className = "menu-title-row";
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "menu-collapse-btn";
    collapse.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>`;
    collapse.title = collapse.ariaLabel = isCollapsed ? t("menu.expand") : t("menu.collapse");
    collapse.setAttribute("aria-expanded", String(!isCollapsed));
    collapse.addEventListener("click", () => {
      if (!collapsed.delete(action.uid)) collapsed.add(action.uid);
      render();
    });
    const name = document.createElement("input");
    name.type = "text";
    name.className = "dynamic-name-input";
    name.value = action.name;
    name.placeholder = t("externalAction.defaultName");
    name.addEventListener("input", () => state.renameBookmark("externalAction", action.uid, name.value));
    titleRow.append(collapse, name);
    const actions = document.createElement("div");
    actions.className = "dynamic-header-actions";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "remove-item-btn";
    del.title = del.ariaLabel = t("common.delete");
    setIconContent(del, removeIcon());
    del.addEventListener("click", () => remove(action.uid));
    actions.append(del);
    header.append(titleRow, actions);

    const body = document.createElement("div");
    body.className = "dynamic-card-body";

    const rule = document.createElement("select");
    const options: Array<[string, string]> = [
      ["", t("dynamic.chooseRule")],
      [ALL_URLS_RULE_UID, t("externalAction.allUrls")],
      ...state.settings.urlRules.map((value): [string, string] => [value.uid, value.name || t("urlRules.defaultName")]),
    ];
    for (const [value, text] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      rule.append(option);
    }
    rule.value = options.some(([value]) => value && value === action.urlRuleUid) ? action.urlRuleUid! : "";
    rule.addEventListener("change", () => state.editExternalAction(action.uid, { urlRuleUid: rule.value || undefined }));
    body.append(field(t("externalAction.rule"), rule));

    const targets = document.createElement("div");
    targets.className = "dynamic-field dynamic-mode-options";
    targets.setAttribute("role", "radiogroup");
    const targetsLabel = document.createElement("span");
    targetsLabel.className = "dynamic-field-label";
    targetsLabel.textContent = t("externalAction.target");
    targets.append(targetsLabel);
    for (const target of ["event", "extension"] as const) {
      const option = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `external-action-target-${action.uid}`;
      radio.checked = action.target === target;
      radio.addEventListener("change", () => {
        if (!radio.checked || action.target === target) return;
        // A new event action starts with the default name, matching a freshly added action.
        state.editExternalAction(action.uid, target === "event" && !action.eventName
          ? { target, eventName: DEFAULT_EXTERNAL_EVENT_NAME }
          : { target });
      });
      const text = document.createElement("span");
      text.textContent = t(target === "event" ? "externalAction.targetEvent" : "externalAction.targetExtension");
      option.append(radio, text);
      targets.append(option);
    }
    body.append(targets);

    if (action.target === "extension") {
      body.append(field(t("externalAction.extensionId"), textInput(action.extensionId, "", value =>
        state.editExternalAction(action.uid, { extensionId: value || undefined }))));
    } else {
      body.append(field(t("externalAction.eventName"), textInput(action.eventName, DEFAULT_EXTERNAL_EVENT_NAME, value =>
        state.editExternalAction(action.uid, { eventName: value || undefined }))));
    }

    const data = document.createElement("textarea");
    data.className = "external-action-data";
    data.rows = 3;
    data.spellcheck = false;
    data.value = action.data ?? "";
    data.placeholder = t("externalAction.dataPlaceholder");
    // Events carry the text as-is; only extension messages must be JSON.
    const markInvalid = (): void => data.setAttribute("aria-invalid", String(action.target === "extension" && !isValidExternalActionData(data.value)));
    markInvalid();
    data.addEventListener("input", () => {
      markInvalid();
      state.editExternalAction(action.uid, { data: data.value.trim() || undefined });
    });
    body.append(field(t(action.target === "extension" ? "externalAction.dataJson" : "externalAction.data"), data));

    card.append(header, body);
    return card;
  }

  function render(): void {
    list.replaceChildren();
    const actions = state.settings.externalActions;
    if (!actions.length) {
      const empty = document.createElement("p");
      empty.className = "url-rule-empty-hint";
      empty.textContent = t("customBookmarks.empty");
      list.append(empty);
      return;
    }
    for (const action of actions) list.append(renderCard(action));
  }

  return {
    render,
    /** Adds an action whose card opens for editing. */
    add(action: ExternalAction): void {
      added = action.uid;
      state.addBookmark("externalAction", action);
    },
  };
}
