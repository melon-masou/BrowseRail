import { t } from "@browserail/i18n";
import { customBookmarkReference, type CustomBookmarkType } from "@browserail/protocol";
import { createItemPicker, type PickerItem } from "./item-picker";

export interface CustomBookmarkChoice {
  readonly uid: string;
  readonly name: string;
  readonly url?: string;
  readonly tags?: readonly string[];
}

type MenuChoice = ReturnType<typeof customBookmarkReference> | { type: "staticTag"; staticTag: string };

function bookmarkChoices(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): PickerItem[] {
  return definitions.map(bookmark => ({
    id: bookmark.uid,
    label: bookmark.name || t(`${type}.defaultName`),
    icon: type === "temporary" ? "📌" : type === "dynamic" ? "🜂" : type === "externalAction" ? "🔌" : "🔖",
    ...(bookmark.tags ? { tags: bookmark.tags } : {}),
    ...(type === "static" || type === "temporary" ? { meta: bookmark.url || t("dynamic.noValueShort") } : {}),
  }));
}

function tagChoices(definitions: readonly CustomBookmarkChoice[]): PickerItem[] {
  const tags = new Map<string, number>();
  for (const bookmark of definitions) {
    for (const tag of new Set(bookmark.tags ?? [])) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return [...tags].map(([tag, count]) => ({ id: tag, label: tag, icon: "#", tags: [tag], meta: t("tags.count", { count }) }));
}

export function createCustomBookmarkPicker() {
  const picker = createItemPicker({ rememberSearch: true });
  return {
    pick(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): Promise<string | null> {
      return picker.pick(t("customBookmarks.pickTitle"), bookmarkChoices(type, definitions));
    },
    async pickForMenu(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[], taggedDefinitions: readonly CustomBookmarkChoice[]): Promise<MenuChoice | null> {
      const id = await picker.pick(t("customBookmarks.pickTitle"), { tabs: [
        { label: t("common.bookmarks"), items: bookmarkChoices(type, definitions).map(item => ({ ...item, id: `bookmark:${item.id}` })) },
        { label: t("tags.label"), emptyText: t("tags.empty"), items: tagChoices(taggedDefinitions).map(item => ({ ...item, id: `tag:${item.id}` })) },
      ] });
      return id === null ? null : id.startsWith("tag:") ? { type: "staticTag", staticTag: id.slice(4) } : customBookmarkReference(type, id.slice(9));
    },
    pickTag(definitions: readonly CustomBookmarkChoice[]): Promise<string | null> {
      return picker.pick(t("tags.label"), tagChoices(definitions), t("tags.empty"));
    },
    destroy(): void { picker.destroy(); },
  };
}

export type CustomBookmarkPicker = ReturnType<typeof createCustomBookmarkPicker>;
