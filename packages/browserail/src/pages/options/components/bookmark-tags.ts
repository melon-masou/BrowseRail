import type { CustomBookmarkType } from "@browserail/protocol";
import { t } from "@browserail/i18n";
import { allBookmarkTags, customBookmarkTagDefinitions } from "../../../lib/config/bookmark-tags";
import type { OptionsState } from "../state";
import { addIcon, setIconContent } from "./icons";
import { renderPreservingFocus } from "./render-focus";

export function createBookmarkTags(state: OptionsState, filters: HTMLElement, suggestions: HTMLDataListElement, changed: () => void) {
  const selected = new Set<string>();
  const drafts = new Map<string, string>();

  function update(): void {
    const tags = allBookmarkTags(state.settings);
    for (const tag of selected) if (!tags.includes(tag)) selected.delete(tag);
    const definitions = new Set(customBookmarkTagDefinitions(state.settings).map(bookmark => `${bookmark.type}:${bookmark.uid}`));
    for (const key of drafts.keys()) if (!definitions.has(key)) drafts.delete(key);
    renderPreservingFocus(filters, () => {
      filters.ariaLabel = t("tags.label");
      filters.hidden = tags.length === 0;
      filters.replaceChildren();
      for (const tag of [undefined, ...tags]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "bookmark-tag-filter";
        button.textContent = tag ?? t("tags.all");
        button.setAttribute("aria-pressed", String(tag === undefined ? selected.size === 0 : selected.has(tag)));
        button.addEventListener("click", () => {
          if (tag === undefined) selected.clear();
          else if (!selected.delete(tag)) selected.add(tag);
          changed();
        });
        filters.append(button);
      }
    });
    suggestions.replaceChildren(...tags.map(tag => {
      const option = document.createElement("option");
      option.value = tag;
      return option;
    }));
  }

  function editor(type: CustomBookmarkType, bookmark: { readonly uid: string; readonly tags?: readonly string[] }): HTMLElement {
    const key = `${type}:${bookmark.uid}`;
    const tags = document.createElement("div");
    tags.className = "bookmark-tags";
    const chips = document.createElement("div");
    chips.className = "bookmark-tag-chips";
    for (const tag of bookmark.tags ?? []) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "bookmark-tag-chip";
      chip.textContent = `${tag} ×`;
      chip.title = chip.ariaLabel = t("tags.remove", { tag });
      chip.addEventListener("click", () => state.setBookmarkTags(type, bookmark.uid, (bookmark.tags ?? []).filter(value => value !== tag)));
      chips.append(chip);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "bookmark-tag-input";
    input.placeholder = input.ariaLabel = t("tags.add");
    input.setAttribute("list", suggestions.id);
    input.value = drafts.get(key) ?? "";
    input.addEventListener("input", () => drafts.set(key, input.value));
    const commit = () => {
      const tag = input.value.trim();
      if (!input.isConnected || !tag) return;
      input.value = "";
      drafts.delete(key);
      state.setBookmarkTags(type, bookmark.uid, [...(bookmark.tags ?? []), tag]);
    };
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      commit();
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "action-btn bookmark-tag-add";
    add.title = add.ariaLabel = t("tags.add");
    setIconContent(add, addIcon());
    add.addEventListener("click", commit);
    const controls = document.createElement("div");
    controls.className = "bookmark-tag-editor";
    controls.append(input, add);
    tags.append(chips, controls);
    return tags;
  }

  return {
    update, editor,
    filter<T extends { readonly tags?: readonly string[] }>(bookmarks: readonly T[]): readonly T[] {
      return bookmarks.filter(bookmark => selected.size === 0 || bookmark.tags?.some(tag => selected.has(tag)));
    },
    clearFilter(): void { selected.clear(); },
    destroy(): void { drafts.clear(); filters.replaceChildren(); suggestions.replaceChildren(); },
  };
}

export type BookmarkTags = ReturnType<typeof createBookmarkTags>;
