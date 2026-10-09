import browser from "webextension-polyfill";
import { EXTERNAL_DATA_STORAGE_PREFIX, listExternalData } from "../../../lib/config/external-data";
import { createScope } from "../lifecycle";
import { staticBookmarkReferenceErrors, variableReference } from "../../../lib/bookmarks/variables";
import { t } from "@browserail/i18n";
import type { StaticBookmark } from "../../../lib/config";
import type { OptionsState, ReadonlyData } from "../state";
import { renderPreservingFocus } from "./render-focus";
import { addIcon, removeIcon, setIconContent } from "./icons";
import { filterCustomBookmarks } from "../custom-bookmark-search";
import { createVariablePicker } from "./variable-picker";
import { createMoveButtons } from "./move-buttons";

export function createStaticBookmarksList(
  state: OptionsState,
  list: HTMLElement,
  filters: HTMLElement,
  suggestions: HTMLDataListElement,
  removeBookmark: (uid: string) => void,
  showStatus: (message: string) => void,
  getSearchQuery?: () => string,
) {
  const scope = createScope();
  let externalKeys: ReadonlySet<string> | undefined;
  let referenceRevision = 0;
  const variablePicker = createVariablePicker(state, showStatus);
  const selectedTags = new Set<string>();
  const tagDrafts = new Map<string, string>();
  const expandedUids = new Set<string>();

  function refreshReferenceWarnings(): void {
    const bookmarks = new Map(state.settings.staticBookmarks.map(bookmark => [bookmark.uid, bookmark]));
    for (const card of list.querySelectorAll<HTMLElement>("[data-record-id]")) {
      const bookmark = bookmarks.get(card.dataset.recordId!);
      if (!bookmark) continue;
      const errors = staticBookmarkReferenceErrors(bookmark.url, state.settings.userVariables, externalKeys);
      const warning = card.querySelector<HTMLElement>(".reference-warning")!;
      warning.textContent = errors.length ? "!" : "";
      warning.title = warning.ariaLabel = errors.join("\n");
      card.querySelector(".static-url-editor input")?.setAttribute("aria-invalid", String(errors.length > 0));
    }
  }

  async function refreshExternalKeys(): Promise<void> {
    const revision = ++referenceRevision;
    try {
      const entries = await listExternalData();
      if (scope.signal.aborted || revision !== referenceRevision) return;
      externalKeys = new Set(entries.map(([key]) => key));
      refreshReferenceWarnings();
    } catch (error) {
      if (!scope.signal.aborted && revision === referenceRevision) showStatus(String(error));
    }
  }
  const externalChanged = (changes: Record<string, browser.Storage.StorageChange>, area: string): void => {
    if (area === "local" && Object.keys(changes).some(key => key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX)))
      void refreshExternalKeys();
  };
  browser.storage.onChanged.addListener(externalChanged);
  scope.add(() => browser.storage.onChanged.removeListener(externalChanged));
  scope.add(state.subscribe(["variables", "bookmarks"], refreshReferenceWarnings));
  void refreshExternalKeys();

  function renderFilters(tags: readonly string[]): void {
    filters.ariaLabel = t("static.tags");
    filters.hidden = tags.length === 0;
    filters.replaceChildren();
    const all = document.createElement("button");
    all.type = "button";
    all.className = "static-tag-filter";
    all.textContent = t("static.allTags");
    all.setAttribute("aria-pressed", String(selectedTags.size === 0));
    all.addEventListener("click", () => { selectedTags.clear(); render(); });
    filters.append(all);
    for (const tag of tags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "static-tag-filter";
      button.textContent = tag;
      button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
      button.addEventListener("click", () => {
        if (!selectedTags.delete(tag)) selectedTags.add(tag);
        render();
      });
      filters.append(button);
    }
    suggestions.replaceChildren(...tags.map(tag => {
      const option = document.createElement("option");
      option.value = tag;
      return option;
    }));
  }

  function renderCard(bookmark: ReadonlyData<StaticBookmark>, index: number, visible: readonly ReadonlyData<StaticBookmark>[]): HTMLElement {
    const expanded = expandedUids.has(bookmark.uid);
    const card = document.createElement("article");
    card.className = `menu-card custom-bookmark-card static-bookmark-card${expanded ? "" : " is-collapsed"}`;
    card.dataset.recordId = bookmark.uid;
    const header = document.createElement("header");
    const moveButtons = createMoveButtons(index, visible.length, step => {
      state.moveStaticBookmark(bookmark.uid, visible[index + step]!.uid, step === -1 ? "before" : "after");
    });

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "menu-collapse-btn";
    collapse.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>';
    collapse.title = collapse.ariaLabel = t(expanded ? "static.collapse" : "static.expand");
    collapse.setAttribute("aria-expanded", String(expanded));
    collapse.addEventListener("click", () => {
      if (!expandedUids.delete(bookmark.uid)) expandedUids.add(bookmark.uid);
      render();
    });
    const name = document.createElement("input");
    name.type = "text";
    name.className = "dynamic-name-input";
    name.value = bookmark.name;
    name.placeholder = t("static.defaultName");
    name.ariaLabel = t("toolkit.temporaryName");
    name.addEventListener("input", () => state.renameBookmark("static", bookmark.uid, name.value));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item-btn";
    remove.title = remove.ariaLabel = t("common.delete");
    setIconContent(remove, removeIcon());
    remove.addEventListener("click", () => removeBookmark(bookmark.uid));
    const summary = document.createElement("span");
    summary.className = "static-tag-summary";
    summary.textContent = (bookmark.tags ?? []).join(" · ");
    summary.title = summary.textContent;
    summary.hidden = expanded || !bookmark.tags?.length;
    const warning = document.createElement("span");
    warning.className = "reference-warning";
    header.append(collapse, name, warning, summary, moveButtons, remove);

    const body = document.createElement("div");
    body.className = "custom-bookmark-body";
    body.hidden = !expanded;
    const url = document.createElement("input");
    url.type = "text";
    url.inputMode = "url";
    url.value = bookmark.url;
    url.placeholder = "https://";
    url.ariaLabel = t("customBookmarks.url");
    url.addEventListener("input", () => state.setStaticUrl(bookmark.uid, url.value));

    const tags = document.createElement("div");
    tags.className = "static-bookmark-tags";
    const chips = document.createElement("div");
    chips.className = "static-tag-chips";
    for (const tag of bookmark.tags ?? []) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "static-tag-chip";
      chip.textContent = `${tag} ×`;
      chip.title = chip.ariaLabel = t("static.removeTag", { tag });
      chip.addEventListener("click", () => {
        state.setStaticTags(bookmark.uid, (bookmark.tags ?? []).filter(value => value !== tag));
      });
      chips.append(chip);
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "static-tag-input";
    input.placeholder = input.ariaLabel = t("static.addTag");
    input.setAttribute("list", suggestions.id);
    input.value = tagDrafts.get(bookmark.uid) ?? "";
    input.addEventListener("input", () => tagDrafts.set(bookmark.uid, input.value));
    const commit = () => {
      const tag = input.value.trim();
      if (!input.isConnected || !tag) return;
      input.value = "";
      tagDrafts.delete(bookmark.uid);
      state.setStaticTags(bookmark.uid, [...(bookmark.tags ?? []), tag]);
    };
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      commit();
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "action-btn static-tag-add";
    add.title = add.ariaLabel = t("static.addTag");
    setIconContent(add, addIcon());
    add.addEventListener("click", commit);
    const editor = document.createElement("div");
    editor.className = "static-tag-editor";
    editor.append(input, add);
    tags.append(chips, editor);
    const urlEditor = document.createElement("div");
    urlEditor.className = "static-url-editor";
    urlEditor.append(url);
    const addVariable = document.createElement("button");
    addVariable.type = "button";
    addVariable.className = "action-btn";
    addVariable.textContent = t("variables.add");
    addVariable.addEventListener("click", () => {
      const start = url.selectionStart ?? url.value.length;
      const end = url.selectionEnd ?? url.value.length;
      variablePicker.open(addVariable, (source, key) => {
        const currentUrl = [...list.querySelectorAll<HTMLElement>("[data-record-id]")]
          .find(card => card.dataset.recordId === bookmark.uid)?.querySelector<HTMLInputElement>(".static-url-editor input");
        if (!currentUrl) return;
        currentUrl.setRangeText(variableReference(source, key), Math.min(start, currentUrl.value.length), Math.min(end, currentUrl.value.length), "end");
        state.setStaticUrl(bookmark.uid, currentUrl.value);
        currentUrl.focus();
      });
    });
    urlEditor.append(addVariable);
    body.append(urlEditor, tags);
    card.append(header, body);
    return card;
  }

  function render(): void {
    const bookmarks = state.settings.staticBookmarks;
    const tags = [...new Set(bookmarks.flatMap(bookmark => bookmark.tags ?? []))].sort();
    for (const tag of selectedTags) if (!tags.includes(tag)) selectedTags.delete(tag);
    for (const uid of tagDrafts.keys()) if (!bookmarks.some(bookmark => bookmark.uid === uid)) tagDrafts.delete(uid);
    for (const uid of expandedUids) if (!bookmarks.some(bookmark => bookmark.uid === uid)) expandedUids.delete(uid);
    renderPreservingFocus(filters, () => renderFilters(tags));
    renderPreservingFocus(list, () => {
      list.replaceChildren();
      const tagMatched = bookmarks.filter(bookmark => selectedTags.size === 0 || bookmark.tags?.some(tag => selectedTags.has(tag)));
      const query = getSearchQuery ? getSearchQuery() : "";
      const visible = filterCustomBookmarks("static", tagMatched, query);
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "url-rule-empty-hint";
        empty.textContent = t(bookmarks.length ? "static.noMatches" : "customBookmarks.empty");
        list.append(empty);
      }
      visible.forEach((bookmark, index) => list.append(renderCard(bookmark, index, visible)));
    });
    refreshReferenceWarnings();
  }

  return {
    render,
    addBookmark(): void {
      const uid = crypto.randomUUID();
      selectedTags.clear();
      expandedUids.add(uid);
      state.addBookmark("static", { uid, name: t("static.defaultName"), url: "" });
    },
    destroy(): void {
      scope.destroy();
      variablePicker.destroy();
      tagDrafts.clear();
      expandedUids.clear();
      list.replaceChildren();
      filters.replaceChildren();
      suggestions.replaceChildren();
    },
  };
}
