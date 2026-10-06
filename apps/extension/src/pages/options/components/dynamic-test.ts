import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import type { DynamicEvaluation } from "../../../dynamic/evaluate";
import type { OptionsState } from "../state";

interface TestState {
  url: string;
  text: string;
  error: boolean;
  running: boolean;
  revision: number;
  display?: () => void;
}

export function createDynamicTester(state: OptionsState) {
  const inputs = new Map<string, TestState>();
  function reset(uid: string): void {
    const saved = inputs.get(uid);
    if (!saved) return;
    saved.revision++;
    saved.text = "";
    saved.display?.();
  }
  return {
    reset,
    render(uid: string): HTMLElement {
      for (const existing of inputs.keys())
        if (!state.settings.dynamicBookmarks.some(db => db.uid === existing)) inputs.delete(existing);
      const saved = inputs.get(uid) ?? { url: "", text: "", error: false, running: false, revision: 0 };
      inputs.set(uid, saved);
      const root = document.createElement("div");
      root.className = "dynamic-test";
      const row = document.createElement("div");
      row.className = "dynamic-test-inputs";
      const url = document.createElement("input");
      url.type = "text";
      url.inputMode = "url";
      url.autocomplete = "off";
      url.placeholder = t("dynamic.testUrlPlaceholder");
      url.ariaLabel = url.placeholder;
      url.value = saved.url;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-btn";
      button.textContent = t("dynamic.test");
      const output = document.createElement("pre");
      output.className = "dynamic-test-result";
      output.setAttribute("role", "status");
      saved.display = () => {
        button.disabled = saved.running;
        output.hidden = !saved.text;
        output.dataset.error = String(saved.error);
        output.textContent = saved.text;
      };
      saved.display();
      url.addEventListener("input", () => {
        saved.url = url.value;
        reset(uid);
      });
      button.addEventListener("click", async () => {
        const draft = state.settings.dynamicBookmarks.find(db => db.uid === uid);
        if (!draft) return;
        if (saved.running) return;
        saved.running = true;
        saved.text = "";
        saved.display?.();
        const revision = saved.revision;
        try {
          const result: DynamicEvaluation = await browser.runtime.sendMessage({
            type: "testDynamicBookmark",
            bookmark: structuredClone(draft),
            rule: structuredClone(state.settings.urlRules.find(rule => rule.uid === draft.urlRuleUid)),
            url: url.value.trim(),
          });
          if (!inputs.has(uid) || revision !== saved.revision) return;
          saved.error = !result?.ok;
          if (!result) saved.text = t("dynamic.testNoResponse");
          else if (!result.ok) saved.text = result.error;
          else if ("value" in result) saved.text = (result.value as { newUrl: string }).newUrl;
          else saved.text = t(`dynamic.testSkipped.${result.skipped}`);
        } catch (error) {
          if (revision !== saved.revision) return;
          saved.error = true;
          saved.text = String(error);
        } finally {
          saved.running = false;
          saved.display?.();
        }
      });
      row.append(url, button);
      root.append(row, output);
      return root;
    },
    destroy(): void {
      for (const saved of inputs.values()) delete saved.display;
      inputs.clear();
    },
  };
}
