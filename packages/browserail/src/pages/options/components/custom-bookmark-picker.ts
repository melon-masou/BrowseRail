import { t } from "@browserail/i18n";
import { type CustomBookmarkType } from "@browserail/protocol";
import { createItemPicker, type PickerItem } from "./item-picker";

export interface CustomBookmarkChoice {
  readonly uid: string;
  readonly name: string;
  readonly url?: string;
  readonly tags?: readonly string[];
}

type StaticMenuChoice = { type: "static"; staticUid: string } | { type: "staticTag"; staticTag: string };

function bookmarkChoices(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): PickerItem[] {
  return definitions.map(bookmark => ({
    id: bookmark.uid,
    label: bookmark.name || t(`${type}.defaultName`),
    icon: type === "temporary" ? "📌" : type === "dynamic" ? "🜂" : type === "externalAction" ? "🔌" : "🔖",
    ...(type === "static" ? { tags: bookmark.tags } : {}),
    ...(type === "static" || type === "temporary" ? { meta: bookmark.url || t("dynamic.noValueShort") } : {}),
  }));
}

function tagChoices(definitions: readonly CustomBookmarkChoice[]): PickerItem[] {
  const tags = new Map<string, number>();
  for (const bookmark of definitions) {
    for (const tag of new Set(bookmark.tags ?? [])) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }
  return [...tags].map(([tag, count]) => ({ id: tag, label: tag, icon: "#", tags: [tag], meta: t("static.tagCount", { count }) }));
}

export function createCustomBookmarkPicker() {
  const picker = createItemPicker({ rememberSearch: true });
  return {
    pick(type: CustomBookmarkType, definitions: readonly CustomBookmarkChoice[]): Promise<string | null> {
      return picker.pick(t("customBookmarks.pickTitle"), bookmarkChoices(type, definitions));
    },
    async pickStaticForMenu(definitions: readonly CustomBookmarkChoice[]): Promise<StaticMenuChoice | null> {
      const id = await picker.pick(t("customBookmarks.pickTitle"), { tabs: [
        { label: t("common.bookmarks"), items: bookmarkChoices("static", definitions).map(item => ({ ...item, id: `bookmark:${item.id}` })) },
        { label: t("static.tags"), emptyText: t("static.noTags"), items: tagChoices(definitions).map(item => ({ ...item, id: `tag:${item.id}` })) },
      ] });
      return id === null ? null : id.startsWith("tag:") ? { type: "staticTag", staticTag: id.slice(4) } : { type: "static", staticUid: id.slice(9) };
    },
    pickStaticTag(definitions: readonly CustomBookmarkChoice[]): Promise<string | null> {
      return picker.pick(t("static.tags"), tagChoices(definitions), t("static.noTags"));
    },
    destroy(): void { picker.destroy(); },
  };
}

export type CustomBookmarkPicker = ReturnType<typeof createCustomBookmarkPicker>;
