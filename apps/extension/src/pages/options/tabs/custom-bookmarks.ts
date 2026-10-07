import { type CustomBookmarkType } from "@browserail/protocol";
import { type DynamicBookmark, type TemporaryBookmark } from "../../../config";
import { t } from "@browserail/i18n";
import { type ReadonlyData, type OptionsState } from "../state";
import { element } from "../dom";
import { createScope } from "../lifecycle";

import { type CustomBookmarkSource } from "../custom-bookmark-source";
import { type Overlays } from "../components/overlays";
import { type BookmarkTools } from "../components/bookmark-tools";
import { addIcon, checkIcon, copyIcon, removeIcon, setIconContent } from "../components/icons";
import { renderPreservingFocus } from "../components/render-focus";
import { createDynamicTester } from "../components/dynamic-test";
import { DEFAULT_REWRITE } from "../../../dynamic/rewrite";
import { mountVariables } from "../components/variables";
import { createStaticBookmarksList } from "../components/static-bookmarks";

export function mountCustomBookmarksTab(
  state: OptionsState,
  source: CustomBookmarkSource,
  tools: BookmarkTools,
  overlays: Overlays,
  showStatus: (message: string) => void,
) {
  const scope = createScope();
  const variables = mountVariables(state, showStatus);
  scope.add(variables.destroy);
  const tester = createDynamicTester(state);
  scope.add(tester.destroy);
  const dynamicList = element<HTMLDivElement>("dynamic-list");
  const staticList = element<HTMLDivElement>("static-list");
  const staticBookmarks = createStaticBookmarksList(
    state,
    staticList,
    element("static-tag-filters"),
    element<HTMLDataListElement>("static-tag-options"),
    uid => removeCustomDefinition("static", uid),
    showStatus,
  );
  scope.add(staticBookmarks.destroy);
  const temporaryList = element<HTMLDivElement>("temporary-list");
  const addDynamicBtn = element<HTMLButtonElement>("add-dynamic-btn");
  function removeCustomDefinition(type: CustomBookmarkType, uid: string): void {
    state.removeBookmark(type, uid);
    collapsedDynamicUids.delete(uid);
    overlays.close("itemSettings");
    overlays.close("shortcutSettings");
  }

  function renderSimpleBookmarks(): void {
    staticBookmarks.render();
    temporaryList.replaceChildren();
    const definitions = source.definitions("temporary");
    if (!definitions.length) {
      const empty = document.createElement("p");
      empty.className = "url-rule-empty-hint";
      empty.textContent = t("customBookmarks.empty");
      temporaryList.append(empty);
    }
    for (const definition of definitions) temporaryList.append(renderTemporaryCard(definition));
  }

  function renderTemporaryCard(definition: TemporaryBookmark): HTMLElement {
    const card = document.createElement("article");
    card.className = "menu-card dynamic-card temporary-bookmark-card";
    card.dataset.recordId = definition.uid;
    const header = document.createElement("header");
    const titleRow = document.createElement("div");
    titleRow.className = "menu-title-row";
    const name = document.createElement("input");
    name.type = "text";
    name.className = "dynamic-name-input";
    name.value = definition.name;
    name.placeholder = t("temporary.defaultName");
    name.ariaLabel = t("toolkit.temporaryName");
    name.addEventListener("input", () => {
      state.renameBookmark("temporary", definition.uid, name.value);
    });
    titleRow.append(name);
    const headerActions = document.createElement("div");
    headerActions.className = "dynamic-header-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-item-btn";
    remove.title = remove.ariaLabel = t("common.delete");
    setIconContent(remove, removeIcon());
    remove.addEventListener("click", () => removeCustomDefinition("temporary", definition.uid));
    headerActions.append(remove);

    const subtitle = document.createElement("div");
    subtitle.className = "dynamic-subtitle-row";
    const current = document.createElement("div");
    current.className = "dynamic-current-group";
    const currentLabel = document.createElement("span");
    currentLabel.className = "dynamic-current-label";
    currentLabel.textContent = `${t("dynamic.currentLabel")}:`;
    current.append(currentLabel);
    const url = source.temporaryValues[definition.uid];
    const note = source.temporaryNotes[definition.uid];
    appendCurrentUrl(current, url, note);
    const actions = document.createElement("div");
    actions.className = "dynamic-card-actions";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "action-btn dynamic-add-btn";
    clear.textContent = t("customBookmarks.clear");
    clear.disabled = !url && !note;
    clear.addEventListener("click", () => {
      void source.clearTemporary(definition.uid).catch((error) => {
        showStatus(String(error));
      });
    });
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "action-btn dynamic-add-btn";
    setIconContent(marker, addIcon(), t("dynamic.addToBookmarks"));
    marker.disabled = !tools.available;
    marker.addEventListener("click", () => tools.openTemporary(definition.uid));
    actions.append(clear, marker);
    subtitle.append(current, actions);
    header.append(titleRow, headerActions, subtitle);
    card.append(header);
    if (note) {
      const row = document.createElement("div");
      row.className = "custom-bookmark-note";
      const title = document.createElement("span");
      title.textContent = t("customBookmarks.note");
      const text = document.createElement("span");
      text.textContent = note;
      row.append(title, text);
      card.append(row);
    }
    return card;
  }

  function initCustomBookmarksPanel(): void {
    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-custom-bookmark-panel]"),
    );
    for (const tab of tabs)
      tab.addEventListener(
        "click",
        () => {
          for (const candidate of tabs) {
            const selected = candidate === tab;
            candidate.classList.toggle("is-active", selected);
            candidate.setAttribute("aria-selected", String(selected));
            document.getElementById(candidate.dataset.customBookmarkPanel!)!.hidden = !selected;
          }
          if (tab.id === "temporary-tab") void source.refreshTemporary();
        },
        { signal: scope.signal },
      );
    element<HTMLButtonElement>("add-static-btn").addEventListener(
      "click",
      () => staticBookmarks.addBookmark(),
      { signal: scope.signal },
    );
    element<HTMLButtonElement>("add-temporary-btn").addEventListener(
      "click",
      () => {
        state.addBookmark("temporary", {
          uid: crypto.randomUUID(),
          name: t("temporary.defaultName"),
        });
      },
      { signal: scope.signal },
    );
    document.getElementById("custom-bookmarks-tab")?.addEventListener(
      "click",
      () => {
        void source.refreshTemporary();
        void source.refreshDynamic();
      },
      { signal: scope.signal },
    );
  }

  function createDynamicBookmark(): DynamicBookmark {
    return { uid: crypto.randomUUID(), name: t("dynamic.defaultName"), type: "rule", rewrite: DEFAULT_REWRITE };
  }

  const collapsedDynamicUids = new Set<string>();

  function renderDynamicList(): void {
    dynamicList.replaceChildren();
    if (state.settings.dynamicBookmarks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "url-rule-empty-hint";
      empty.textContent = t("dynamic.empty");
      dynamicList.append(empty);
      return;
    }
    for (const db of state.settings.dynamicBookmarks) {
      dynamicList.append(renderDynamicCard(db));
    }
  }

  function appendCurrentUrl(parent: HTMLElement, url: string | undefined, title?: string): void {
    if (url) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dynamic-current-chip";
      const fullTooltip = `${title ? `${title}\n` : ""}${url}\n(${t("dynamic.copyTooltip")})`;
      chip.title = fullTooltip;
      chip.setAttribute("aria-label", fullTooltip);

      const displayTitle = url;
      setIconContent(chip, copyIcon(), displayTitle, "dynamic-current-title");

      let resetTimer: ReturnType<typeof setTimeout> | undefined;
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(url).then(() => {
          chip.classList.add("is-copied");
          setIconContent(chip, checkIcon(), t("dynamic.copied"), "dynamic-current-title");
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = scope.timeout(() => {
            chip.classList.remove("is-copied");
            setIconContent(chip, copyIcon(), displayTitle, "dynamic-current-title");
          }, 1500);
        });
      });

      parent.append(chip);
    } else {
      const emptySpan = document.createElement("span");
      emptySpan.className = "dynamic-current-empty";
      emptySpan.textContent = t("dynamic.noValue");
      parent.append(emptySpan);
    }
  }

  function renderDynamicCard(db: ReadonlyData<DynamicBookmark>): HTMLElement {
    const isCollapsed = collapsedDynamicUids.has(db.uid);
    const card = document.createElement("article");
    card.className = `menu-card dynamic-card${isCollapsed ? " is-collapsed" : ""}`;
    card.dataset.collapsed = String(isCollapsed);
    card.dataset.recordId = db.uid;

    const header = document.createElement("header");
    const titleRow = document.createElement("div");
    titleRow.className = "menu-title-row";

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "menu-collapse-btn";
    collapseBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>`;
    collapseBtn.title = isCollapsed ? t("menu.expand") : t("menu.collapse");
    collapseBtn.setAttribute("aria-label", collapseBtn.title);
    collapseBtn.setAttribute("aria-expanded", String(!isCollapsed));
    collapseBtn.addEventListener("click", () => {
      if (collapsedDynamicUids.has(db.uid)) {
        collapsedDynamicUids.delete(db.uid);
      } else {
        collapsedDynamicUids.add(db.uid);
      }
      renderDynamicList();
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "dynamic-name-input";
    nameInput.value = db.name;
    nameInput.placeholder = t("dynamic.defaultName");
    nameInput.addEventListener("input", () => {
      state.renameBookmark("dynamic", db.uid, nameInput.value);
    });

    titleRow.append(collapseBtn, nameInput);

    const headerActions = document.createElement("div");
    headerActions.className = "dynamic-header-actions";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "remove-item-btn";
    del.title = t("common.delete");
    del.setAttribute("aria-label", t("common.delete"));
    setIconContent(del, removeIcon());
    del.addEventListener("click", () => {
      removeCustomDefinition("dynamic", db.uid);
    });

    headerActions.append(del);

    const live = source.dynamicValues[db.uid];
    const subtitleRow = document.createElement("div");
    subtitleRow.className = "dynamic-subtitle-row";

    const currentGroup = document.createElement("div");
    currentGroup.className = "dynamic-current-group";

    const currentLabel = document.createElement("span");
    currentLabel.className = "dynamic-current-label";
    currentLabel.textContent = `${t("dynamic.currentLabel")}:`;
    currentGroup.append(currentLabel);

    appendCurrentUrl(currentGroup, live?.url, live?.title);

    const actionsGroup = document.createElement("div");
    actionsGroup.className = "dynamic-card-actions";

    const addToBookmarksBtn = document.createElement("button");
    addToBookmarksBtn.type = "button";
    addToBookmarksBtn.className = "action-btn dynamic-add-btn";
    setIconContent(addToBookmarksBtn, addIcon(), t("dynamic.addToBookmarks"));
    addToBookmarksBtn.title = t("dynamic.addToBookmarks");
    addToBookmarksBtn.disabled = !tools.available;
    addToBookmarksBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      tools.openDynamic(db.uid);
    });

    actionsGroup.append(addToBookmarksBtn);
    subtitleRow.append(currentGroup, actionsGroup);
    header.append(titleRow, headerActions, subtitleRow);

    // All update methods share the selected URL rule; switching keeps editor content.
    const body = document.createElement("div");
    body.className = "dynamic-card-body";

    if (db.type === "external" && live?.source) {
      const status = document.createElement("div");
      status.className = "dynamic-api-status";
      const origin = document.createElement("div");
      origin.textContent = t("dynamic.apiSource", { source: live.source });
      status.append(origin);
      if (live.error) {
        const error = document.createElement("div");
        error.className = "dynamic-api-error";
        error.textContent = [live.error, live.errmsg].filter(Boolean).join(": ");
        status.append(error);
      }
      body.append(status);
    }

    const ruleField = document.createElement("label");
    ruleField.className = "dynamic-field";
    const ruleLabel = document.createElement("span");
    ruleLabel.className = "dynamic-field-label";
    ruleLabel.textContent = t("dynamic.ruleMode");
    const ruleSelect = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t("dynamic.chooseRule");
    ruleSelect.append(placeholder);
    for (const rule of state.settings.urlRules) {
      const option = document.createElement("option");
      option.value = rule.uid;
      option.textContent = rule.name || t("urlRules.defaultName");
      ruleSelect.append(option);
    }
    ruleSelect.value = state.settings.urlRules.some((rule) => rule.uid === db.urlRuleUid) ? db.urlRuleUid! : "";
    ruleSelect.addEventListener("change", () => {
      tester.reset(db.uid);
      state.setDynamicRule(db.uid, ruleSelect.value || undefined);
    });
    ruleField.append(ruleLabel, ruleSelect);
    body.append(ruleField);
    const modeField = document.createElement("div");
    modeField.className = "dynamic-field dynamic-mode-options";
    modeField.setAttribute("role", "radiogroup");
    const modeLabel = document.createElement("span");
    modeLabel.className = "dynamic-field-label";
    modeLabel.textContent = t("dynamic.mode");
    modeField.append(modeLabel);
    for (const type of ["rule", "rewrite", "external"] as const) {
      const option = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `dynamic-mode-${db.uid}`;
      radio.checked = db.type === type;
      radio.addEventListener("change", () => {
        if (radio.checked && db.type !== type) {
          tester.reset(db.uid);
          state.setDynamicType(db.uid, type);
        }
      });
      const text = document.createElement("span");
      text.textContent = t(type === "rule" ? "dynamic.updateAll" : type === "rewrite" ? "dynamic.rewriteMode" : "dynamic.externalMode");
      option.append(radio, text);
      modeField.append(option);
    }
    body.append(modeField);
    if (db.type !== "rewrite") {
      const ruleHint = document.createElement("div");
      ruleHint.className = "hint";
      ruleHint.textContent = t(db.type === "rule" ? "dynamic.ruleHint" : "dynamic.externalHint");
      body.append(ruleHint);
      if (db.type === "external") {
        const uidField = document.createElement("label");
        uidField.className = "dynamic-field";
        const label = document.createElement("span");
        label.className = "dynamic-field-label";
        label.textContent = "UID";
        const uid = document.createElement("input");
        uid.type = "text";
        uid.readOnly = true;
        uid.value = db.uid;
        uidField.append(label, uid);
        body.append(uidField);
      }
      card.append(header, body);
      return card;
    }
    const risk = document.createElement("p");
    risk.className = "dynamic-rewrite-warning";
    risk.textContent = t("dynamic.rewriteWarning");
    body.append(risk);
    const rewrite = document.createElement("textarea");
    rewrite.className = "dynamic-rewrite";
    rewrite.rows = 14;
    rewrite.spellcheck = false;
    rewrite.value = db.rewrite ?? "";
    rewrite.ariaLabel = t("dynamic.rewriteMode");
    const updateRewrite = () => {
      tester.reset(db.uid);
      state.setDynamicRewrite(db.uid, rewrite.value);
    };
    rewrite.addEventListener("input", () => {
      updateRewrite();
    });
    rewrite.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = rewrite.selectionStart;
        const end = rewrite.selectionEnd;
        rewrite.value = rewrite.value.substring(0, start) + "  " + rewrite.value.substring(end);
        rewrite.selectionStart = rewrite.selectionEnd = start + 2;
        updateRewrite();
      }
    });

    body.append(rewrite);
    body.append(tester.render(db.uid));
    card.append(header, body);
    return card;
  }

  function initDynamicPanel(): void {
    addDynamicBtn.addEventListener(
      "click",
      () => {
        const newDb = createDynamicBookmark();
        collapsedDynamicUids.delete(newDb.uid);
        state.addBookmark("dynamic", newDb);
      },
      { signal: scope.signal },
    );
    document.getElementById("dynamic-tab")?.addEventListener(
      "click",
      () => {
        void source.refreshDynamic();
      },
      { signal: scope.signal },
    );

    void source.refreshDynamic();
  }
  const renderSimple = () =>
    renderPreservingFocus(element("custom-bookmarks-panel"), renderSimpleBookmarks);
  const renderDynamic = () => renderPreservingFocus(dynamicList, renderDynamicList);
  const render = () => {
    variables.render();
    renderSimple();
    renderDynamic();
  };
  for (const bookmark of state.settings.dynamicBookmarks) collapsedDynamicUids.add(bookmark.uid);
  scope.add(
    state.subscribe(["bookmarks"], (change) => {
      if (change.imported)
        for (const bookmark of state.settings.dynamicBookmarks)
          collapsedDynamicUids.add(bookmark.uid);
      if (change.structural) render();
    }),
  );
  scope.add(state.subscribe(["rules"], () => {
    for (const bookmark of state.settings.dynamicBookmarks) tester.reset(bookmark.uid);
    renderDynamic();
  }));
  scope.add(
    source.subscribe((type) => {
      if (type === "temporary") renderSimple();
      else renderDynamic();
    }),
  );
  initCustomBookmarksPanel();
  initDynamicPanel();
  render();
  return {
    render,
    destroy(): void {
      scope.destroy();
      staticList.replaceChildren();
      temporaryList.replaceChildren();
      dynamicList.replaceChildren();
    },
  };
}
