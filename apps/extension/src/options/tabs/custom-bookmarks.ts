import { type CustomBookmarkType } from "@browserail/protocol";
import { type DynamicBookmark, type TemporaryBookmark } from "../../config";
import { t } from "@browserail/i18n";
import { type ReadonlyData, type OptionsState } from "../state";
import { element } from "../dom";
import { createScope } from "../lifecycle";

import { type CustomBookmarkSource } from "../custom-bookmark-source";
import { type Overlays } from "../components/overlays";
import { type BookmarkTools } from "../components/bookmark-tools";
import { SETTINGS_ICON_SVG, REMOVE_ICON_SVG } from "../components/icons";
import { renderPreservingFocus } from "../components/render-focus";

export function mountCustomBookmarksTab(
  state: OptionsState,
  source: CustomBookmarkSource,
  tools: BookmarkTools,
  overlays: Overlays,
  showStatus: (message: string) => void,
) {
  const scope = createScope();
  const dynamicList = element<HTMLDivElement>("dynamic-list");
  const staticList = element<HTMLDivElement>("static-list");
  const temporaryList = element<HTMLDivElement>("temporary-list");
  const addDynamicBtn = element<HTMLButtonElement>("add-dynamic-btn");
  const dynamicSettingsDialog = element<HTMLDialogElement>("dynamic-settings-dialog");
  const dynamicSettingsDialogTitle = element<HTMLSpanElement>("dynamic-settings-dialog-title");
  const dynamicSettingsClose = element<HTMLButtonElement>("dynamic-settings-close");
  const dynamicSettingUrlRulesList = element<HTMLDivElement>("dynamic-setting-url-rules-list");
  const DEFAULT_DYNAMIC_CODE = `/**
 * Dynamic Bookmark Handler
 *
 * @param {Object} context
 * @param {string} context.action  - Trigger event: "visit"
 * @param {string} context.url     - URL of the visited page
 * @param {string} context.title   - Title of the visited page
 * @param {Object} context.current - Current bookmark state: { url, title, note }
 * @param {string} context.current.note - Saved script context; empty string before the first save
 *
 * @returns {Object}
 *   - { newUrl: string, title?: string, note?: string } - Updates the URL; title defaults to the visited page's title
 *   - { newUrl: null, note?: string } - Keeps the URL and title unchanged; can still update note
 *   - note: a string saved for later calls, including after restart; omitted = keep, "" = clear
 */
function dynamicBookmark({ action, url, title, current }) {
  // Example 1: Track the last visited GitHub repository
  // if (url.startsWith("https://github.com/")) {
  //   return { newUrl: url, title };
  // }

  // Example 2: Track docs pages and customize bookmark title
  // if (url.includes("/docs/")) {
  //   return { newUrl: url, title: \`Doc: \${title}\` };
  // }

  // Example 3: Keep script context between visits without changing the URL
  // const visits = Number(current.note || "0") + 1;
  // return { newUrl: null, note: String(visits) };

  return { newUrl: null };
}
`;

  function removeCustomDefinition(type: CustomBookmarkType, uid: string): void {
    state.removeBookmark(type, uid);
    collapsedDynamicUids.delete(uid);
    overlays.close("itemSettings");
    overlays.close("shortcutSettings");
  }

  function renderSimpleBookmarks(): void {
    for (const type of ["static", "temporary"] as const) {
      const list = type === "static" ? staticList : temporaryList;
      list.replaceChildren();
      const definitions = source.definitions(type);
      if (!definitions.length) {
        const empty = document.createElement("p");
        empty.className = "url-rule-empty-hint";
        empty.textContent = t("customBookmarks.empty");
        list.append(empty);
      }
      for (const definition of definitions) {
        if (type === "temporary") {
          list.append(renderTemporaryCard(definition));
          continue;
        }
        if (!("url" in definition)) continue;
        const card = document.createElement("article");
        card.className = "menu-card custom-bookmark-card";
        card.dataset.recordId = definition.uid;
        const header = document.createElement("header");
        const name = document.createElement("input");
        name.type = "text";
        name.className = "dynamic-name-input";
        name.value = definition.name;
        name.placeholder = t("static.defaultName");
        name.ariaLabel = t("toolkit.temporaryName");
        name.addEventListener("input", () => {
          state.renameBookmark(type, definition.uid, name.value);
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-item-btn menu-remove-btn";
        remove.textContent = t("common.delete");
        remove.addEventListener("click", () => removeCustomDefinition("static", definition.uid));
        header.append(name, remove);
        const body = document.createElement("div");
        body.className = "custom-bookmark-body";
        const url = document.createElement("input");
        url.type = "text";
        url.inputMode = "url";
        url.value = definition.url;
        url.placeholder = "https://";
        url.ariaLabel = t("customBookmarks.url");
        url.addEventListener("input", () => {
          state.setStaticUrl(definition.uid, url.value);
        });
        body.append(url);
        card.append(header, body);
        list.append(card);
      }
    }
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
    remove.className = "remove-item-btn menu-remove-btn";
    remove.innerHTML = `${REMOVE_ICON_SVG}<span>${t("common.delete")}</span>`;
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
    marker.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>${t("dynamic.addToBookmarks")}</span>`;
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
      () => {
        state.addBookmark("static", {
          uid: crypto.randomUUID(),
          name: t("static.defaultName"),
          url: "",
        });
      },
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
    return { uid: crypto.randomUUID(), name: t("dynamic.defaultName"), code: DEFAULT_DYNAMIC_CODE };
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

  function openDynamicSettingsDialog(db: ReadonlyData<DynamicBookmark>): void {
    dynamicSettingsDialogTitle.textContent = `${db.name || t("dynamic.defaultName")} - ${t("menu.settings")}`;
    renderDynamicUrlRulesContent(db);
    dynamicSettingsDialog.showModal();
  }

  function renderDynamicUrlRulesContent(db: ReadonlyData<DynamicBookmark>): void {
    dynamicSettingUrlRulesList.replaceChildren();

    const allRow = document.createElement("label");
    allRow.className = "menu-setting-url-rule-item";
    const allRadio = document.createElement("input");
    allRadio.type = "checkbox";
    const hasSpecificSets = Array.isArray(db.urlRuleUids) && db.urlRuleUids.length > 0;
    allRadio.checked = !hasSpecificSets;

    const allSpan = document.createElement("span");
    allSpan.textContent = t("menuBehavior.allUrls");
    allRow.append(allRadio, allSpan);
    dynamicSettingUrlRulesList.appendChild(allRow);

    allRadio.addEventListener("change", () => {
      state.setDynamicRules(
        db.uid,
        allRadio.checked ? [] : state.settings.urlRules[0] ? [state.settings.urlRules[0].uid] : [],
      );
      renderDynamicUrlRulesContent(
        state.settings.dynamicBookmarks.find((value) => value.uid === db.uid)!,
      );
    });

    if (state.settings.urlRules.length === 0) {
      const hint = document.createElement("div");
      hint.className = "url-rule-empty-hint";
      hint.style.fontSize = "11px";
      hint.style.padding = "6px";
      hint.textContent = t("menuBehavior.noUrlRules");
      dynamicSettingUrlRulesList.appendChild(hint);
    } else {
      state.settings.urlRules.forEach((rule) => {
        const row = document.createElement("label");
        row.className = "menu-setting-url-rule-item";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Array.isArray(db.urlRuleUids) && db.urlRuleUids.includes(rule.uid);
        cb.addEventListener("change", () => {
          const current =
            state.settings.dynamicBookmarks.find((value) => value.uid === db.uid)!.urlRuleUids ??
            [];
          state.setDynamicRules(
            db.uid,
            cb.checked ? [...current, rule.uid] : current.filter((uid) => uid !== rule.uid),
          );
          renderDynamicUrlRulesContent(
            state.settings.dynamicBookmarks.find((value) => value.uid === db.uid)!,
          );
        });

        const span = document.createElement("span");
        span.textContent = rule.name || t("urlRules.defaultName");
        if (rule.patterns.length > 0) {
          span.title = rule.patterns.join("\n");
        }

        row.append(cb, span);
        dynamicSettingUrlRulesList.appendChild(row);
      });
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

      const copyIcon = `<svg class="dynamic-current-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      const checkIcon = `<svg class="dynamic-current-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      const displayTitle = url;
      chip.innerHTML = `${copyIcon}<span class="dynamic-current-title"></span>`;
      const titleSpan = chip.querySelector(".dynamic-current-title") as HTMLElement;
      titleSpan.textContent = displayTitle;

      let resetTimer: ReturnType<typeof setTimeout> | undefined;
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(url).then(() => {
          chip.classList.add("is-copied");
          chip.innerHTML = `${checkIcon}<span class="dynamic-current-title"></span>`;
          (chip.querySelector(".dynamic-current-title") as HTMLElement).textContent =
            t("dynamic.copied");
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = scope.timeout(() => {
            chip.classList.remove("is-copied");
            chip.innerHTML = `${copyIcon}<span class="dynamic-current-title"></span>`;
            (chip.querySelector(".dynamic-current-title") as HTMLElement).textContent =
              displayTitle;
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

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "action-btn menu-header-btn";
    settingsBtn.innerHTML = `${SETTINGS_ICON_SVG}<span>${t("menu.settings")}</span>`;
    settingsBtn.title = t("menu.settingsTitle");
    settingsBtn.addEventListener("click", () => {
      openDynamicSettingsDialog(db);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "remove-item-btn menu-remove-btn";
    del.title = t("common.delete");
    del.setAttribute("aria-label", t("common.delete"));
    del.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"></line></svg><span>${t("common.delete")}</span>`;
    del.addEventListener("click", () => {
      removeCustomDefinition("dynamic", db.uid);
    });

    headerActions.append(settingsBtn, del);

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
    addToBookmarksBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>${t("dynamic.addToBookmarks")}</span>`;
    addToBookmarksBtn.title = t("dynamic.addToBookmarks");
    addToBookmarksBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      tools.openDynamic(db.uid);
    });

    actionsGroup.append(addToBookmarksBtn);
    subtitleRow.append(currentGroup, actionsGroup);
    header.append(titleRow, headerActions, subtitleRow);

    // Card Body: pure code editor
    const body = document.createElement("div");
    body.className = "dynamic-card-body";

    const code = document.createElement("textarea");
    code.className = "dynamic-code";
    code.rows = 14;
    code.spellcheck = false;
    code.value = db.code;
    code.addEventListener("input", () => {
      state.setDynamicCode(db.uid, code.value);
    });
    code.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const start = code.selectionStart;
        const end = code.selectionEnd;
        code.value = code.value.substring(0, start) + "  " + code.value.substring(end);
        code.selectionStart = code.selectionEnd = start + 2;
        state.setDynamicCode(db.uid, code.value);
      }
    });

    body.append(code);
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

    dynamicSettingsClose.addEventListener("click", () => dynamicSettingsDialog.close(), {
      signal: scope.signal,
    });
    dynamicSettingsDialog.addEventListener(
      "click",
      (e) => {
        if (e.target === dynamicSettingsDialog) dynamicSettingsDialog.close();
      },
      { signal: scope.signal },
    );

    void source.refreshDynamic();
  }
  const renderSimple = () =>
    renderPreservingFocus(element("custom-bookmarks-panel"), renderSimpleBookmarks);
  const renderDynamic = () => renderPreservingFocus(dynamicList, renderDynamicList);
  const render = () => {
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
      dynamicSettingsDialog.close();
      scope.destroy();
      staticList.replaceChildren();
      temporaryList.replaceChildren();
      dynamicList.replaceChildren();
      dynamicSettingUrlRulesList.replaceChildren();
    },
  };
}
