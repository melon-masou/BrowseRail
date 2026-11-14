import type { StorageChange } from "@browserail/runtime-adapter";
import { getRuntimeAdapter } from "@browserail/runtime-adapter";
import { EXTERNAL_DATA_STORAGE_PREFIX, listExternalData } from "../../../lib/config/external-data";
import { createScope } from "../lifecycle";
import { staticBookmarkReferenceErrors, variableReference } from "../../../lib/bookmarks/variables";
import { t } from "@browserail/i18n";
import type { StaticBookmark } from "../../../lib/config/index";
import type { OptionsState, ReadonlyData } from "../state";
import { renderPreservingFocus } from "./render-focus";
import { removeIcon, setIconContent } from "./icons";
import { filterCustomBookmarks } from "../custom-bookmark-search";
import { createVariablePicker } from "./variable-picker";
import { createDragSort } from "./drag-sort";
import type { BookmarkTags } from "./bookmark-tags";

export function createStaticBookmarksList(
  state: OptionsState,
  list: HTMLElement,
  tags: BookmarkTags,
  removeBookmark: (uid: string) => void,
  showStatus: (message: string) => void,
  getSearchQuery?: () => string,
) {
  const scope = createScope();
  let externalKeys: ReadonlySet<string> | undefined;
  let referenceRevision = 0;
  const variablePicker = createVariablePicker(state, showStatus);
  const expandedUids = new Set<string>();
  const dragSort = createDragSort((sourceUid, targetUid, position) => {
    state.moveStaticBookmark(sourceUid, targetUid, position);
  });

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
  const externalChanged = (changes: Record<string, StorageChange>, area: string): void => {
    if (area === "local" && Object.keys(changes).some(key => key.startsWith(EXTERNAL_DATA_STORAGE_PREFIX)))
      void refreshExternalKeys();
  };
  getRuntimeAdapter().storage.onChanged.addListener(externalChanged);
  scope.add(() => getRuntimeAdapter().storage.onChanged.removeListener(externalChanged));
  scope.add(state.subscribe(["variables", "bookmarks"], refreshReferenceWarnings));
  void refreshExternalKeys();

  function renderCard(bookmark: ReadonlyData<StaticBookmark>): HTMLElement {
    const expanded = expandedUids.has(bookmark.uid);
    const card = document.createElement("article");
    card.className = `menu-card custom-bookmark-card static-bookmark-card${expanded ? "" : " is-collapsed"}`;
    card.dataset.recordId = bookmark.uid;
    const header = document.createElement("header");
    const dragHandle = dragSort.handle(card);

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
    summary.className = "bookmark-tag-summary";
    summary.textContent = (bookmark.tags ?? []).join(" · ");
    summary.title = summary.textContent;
    summary.hidden = expanded || !bookmark.tags?.length;
    const warning = document.createElement("span");
    warning.className = "reference-warning";
    header.append(collapse, name, warning, summary, dragHandle, remove);

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
    body.append(urlEditor, tags.editor("static", bookmark));
    card.append(header, body);
    return card;
  }

  function render(): void {
    dragSort.clear();
    const bookmarks = state.settings.staticBookmarks;
    for (const uid of expandedUids) if (!bookmarks.some(bookmark => bookmark.uid === uid)) expandedUids.delete(uid);
    renderPreservingFocus(list, () => {
      list.replaceChildren();
      const tagMatched = tags.filter(bookmarks);
      const query = getSearchQuery ? getSearchQuery() : "";
      const visible = filterCustomBookmarks("static", tagMatched, query);
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "url-rule-empty-hint";
        empty.textContent = t(bookmarks.length ? "static.noMatches" : "customBookmarks.empty");
        list.append(empty);
      }
      visible.forEach(bookmark => list.append(renderCard(bookmark)));
    });
    refreshReferenceWarnings();
  }

  return {
    render,
    addBookmark(): void {
      const uid = crypto.randomUUID();
      tags.clearFilter();
      expandedUids.add(uid);
      state.addBookmark("static", { uid, name: t("static.defaultName"), url: "" });
    },
    destroy(): void {
      dragSort.clear();
      scope.destroy();
      variablePicker.destroy();
      expandedUids.clear();
      list.replaceChildren();
    },
  };
}
