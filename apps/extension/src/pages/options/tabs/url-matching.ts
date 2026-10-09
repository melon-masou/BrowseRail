import { activeUrlPatterns } from "@browserail/protocol";
import { type UrlRule } from "../../../config";
import { t } from "@browserail/i18n";
import { element } from "../dom";
import { createScope } from "../lifecycle";
import { type OptionsState } from "../state";
import { renderPreservingFocus } from "../components/render-focus";
import { removeIcon, setIconContent } from "../components/icons";

export function mountUrlMatchingTab(state: OptionsState) {
  const scope = createScope();
  const addUrlRuleBtn = element<HTMLButtonElement>("add-url-rule-btn");
  const urlRulesList = element<HTMLDivElement>("url-rules-list");
  const globalUrlRuleSelect = element<HTMLSelectElement>("global-url-rule");

  function renderGlobalUrlRuleSelect(): void {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = t("urlRules.all");
    globalUrlRuleSelect.replaceChildren(
      all,
      ...state.settings.urlRules.map((rule) => {
        const option = document.createElement("option");
        option.value = rule.uid;
        option.textContent = rule.name || t("urlRules.defaultName");
        return option;
      }),
    );
    globalUrlRuleSelect.value = state.settings.defaultUrlRuleUid ?? "";
  }

  globalUrlRuleSelect.addEventListener(
    "change",
    () => {
      state.setDefaultRule(globalUrlRuleSelect.value || undefined);
    },
    { signal: scope.signal },
  );

  function renderUrlRules(): void {
    renderGlobalUrlRuleSelect();
    urlRulesList.replaceChildren();

    if (state.settings.urlRules.length === 0) {
      const emptyHint = document.createElement("div");
      emptyHint.className = "url-rule-empty-hint";
      emptyHint.textContent = t("urlRules.empty");
      urlRulesList.appendChild(emptyHint);
      return;
    }

    state.settings.urlRules.forEach((ws) => {
      const card = document.createElement("div");
      card.className = "url-rule-card";
      card.dataset.recordId = ws.uid;

      const header = document.createElement("div");
      header.className = "url-rule-header";

      const titleGroup = document.createElement("div");
      titleGroup.className = "url-rule-title-group";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "url-rule-name-input";
      nameInput.placeholder = t("urlRules.namePlaceholder");
      nameInput.value = ws.name;
      nameInput.addEventListener("input", () => {
        state.renameUrlRule(ws.uid, nameInput.value);
      });

      const countPill = document.createElement("span");
      countPill.className = "url-rule-count-pill";
      function updateCount(): void {
        const rule = state.settings.urlRules.find(value => value.uid === ws.uid)!;
        const count = activeUrlPatterns(rule.patterns).length;
        countPill.textContent = t("urlRules.patternCount", { count });
      }
      updateCount();

      titleGroup.append(nameInput, countPill);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "remove-item-btn";
      deleteBtn.title = t("common.delete");
      deleteBtn.setAttribute("aria-label", t("common.delete"));
      setIconContent(deleteBtn, removeIcon());
      deleteBtn.addEventListener("click", () => {
        state.removeUrlRule(ws.uid);
      });

      header.append(titleGroup, deleteBtn);

      const patternsTextarea = document.createElement("textarea");
      patternsTextarea.className = "url-rule-patterns-input";
      patternsTextarea.rows = 3;
      patternsTextarea.placeholder = t("urlRules.patternsPlaceholder");
      patternsTextarea.value = ws.patterns.join("\n");
      patternsTextarea.addEventListener("input", () => {
        state.setUrlPatterns(ws.uid, patternsTextarea.value);
        updateCount();
      });

      patternsTextarea.ariaLabel = t("section.urlRules");
      card.append(header, patternsTextarea);
      urlRulesList.appendChild(card);
    });
  }

  addUrlRuleBtn.addEventListener(
    "click",
    () => {
      const newSet: UrlRule = {
        uid: crypto.randomUUID(),
        name: t("urlRules.newSetName", { n: state.settings.urlRules.length + 1 }),
        patterns: [],
      };
      state.addUrlRule(newSet);

      const nameInputs = urlRulesList.querySelectorAll<HTMLInputElement>(".url-rule-name-input");
      const lastInput = nameInputs[nameInputs.length - 1];
      if (lastInput) {
        lastInput.focus();
        lastInput.select();
      }
    },
    { signal: scope.signal },
  );
  const render = () => renderPreservingFocus(urlRulesList, renderUrlRules);
  scope.add(
    state.subscribe(["rules"], (change) => {
      if (change.structural) render();
      else renderGlobalUrlRuleSelect();
    }),
  );
  render();
  return { render, destroy: scope.destroy };
}
