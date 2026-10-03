import { t } from "@browserail/i18n";
import { type CustomBookmarkType } from "@browserail/protocol";
import { element } from "../dom";
import { createScope } from "../lifecycle";
export interface CustomBookmarkChoice {
  readonly uid: string;
  readonly name: string;
  readonly url?: string;
}
export function createCustomBookmarkPicker() {
  const scope = createScope();
  const pickDynamicDialog = element<HTMLDialogElement>("pick-dynamic-dialog");
  const pickDynamicTitle = element<HTMLSpanElement>("pick-dynamic-title");
  const pickDynamicClose = element<HTMLButtonElement>("pick-dynamic-close");
  const pickDynamicList = element<HTMLDivElement>("pick-dynamic-list");
  let finish: ((uid: string | null) => void) | undefined;
  pickDynamicClose.addEventListener("click", () => pickDynamicDialog.close(), {
    signal: scope.signal,
  });
  pickDynamicDialog.addEventListener(
    "close",
    () => {
      if (pickDynamicDialog.open) return;
      finish?.(null);
      finish = undefined;
    },
    { signal: scope.signal },
  );
  function render(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): void {
    pickDynamicTitle.textContent = t("customBookmarks.pickTitle");
    pickDynamicList.replaceChildren();
    for (const db of definitions) {
      const itemBtn = document.createElement("button");
      itemBtn.type = "button";
      itemBtn.className = "pick-menu-item";

      const info = document.createElement("div");
      info.className = "pick-menu-item-info";
      const icon = document.createElement("span");
      icon.className = "pick-menu-item-icon";
      icon.textContent = type === "temporary" ? "📌" : type === "dynamic" ? "🜂" : "🔖";
      const title = document.createElement("span");
      title.className = "pick-menu-item-title";
      title.textContent = db.name || t(`${type}.defaultName`);
      info.append(icon, title);

      const meta = document.createElement("span");
      meta.className = "pick-menu-item-meta";
      meta.textContent = db.url || t("dynamic.noValueShort");

      itemBtn.append(info, meta);
      itemBtn.addEventListener("click", () => {
        finish?.(db.uid);
        finish = undefined;
        pickDynamicDialog.close();
      });
      pickDynamicList.append(itemBtn);
    }
    pickDynamicDialog.showModal();
  }

  return {
    pick(
      type: CustomBookmarkType,
      definitions: readonly CustomBookmarkChoice[],
    ): Promise<string | null> {
      if (scope.signal.aborted) return Promise.resolve(null);
      if (pickDynamicDialog.open) pickDynamicDialog.close();
      finish?.(null);
      render(type, definitions);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    destroy(): void {
      finish?.(null);
      finish = undefined;
      pickDynamicDialog.close();
      scope.destroy();
      pickDynamicList.replaceChildren();
    },
  };
}
export type CustomBookmarkPicker = ReturnType<typeof createCustomBookmarkPicker>;
