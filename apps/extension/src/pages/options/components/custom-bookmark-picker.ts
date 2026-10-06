import { t } from "@browserail/i18n";
import { type CustomBookmarkType } from "@browserail/protocol";
import { createItemPicker } from "./item-picker";

export interface CustomBookmarkChoice {
  readonly uid: string;
  readonly name: string;
  readonly url?: string;
}

export function createCustomBookmarkPicker() {
  const picker = createItemPicker();
  return {
    pick(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): Promise<string | null> {
      return picker.pick(t("customBookmarks.pickTitle"), definitions.map(bookmark => ({
        id: bookmark.uid,
        label: bookmark.name || t(`${type}.defaultName`),
        icon: type === "temporary" ? "📌" : type === "dynamic" ? "🜂" : "🔖",
        ...(type !== "dynamic" ? { meta: bookmark.url || t("dynamic.noValueShort") } : {}),
      })));
    },
    destroy(): void { picker.destroy(); },
  };
}

export type CustomBookmarkPicker = ReturnType<typeof createCustomBookmarkPicker>;
