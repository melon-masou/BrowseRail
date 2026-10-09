import {
  applyStaticI18n,
  getLanguage,
  LANGUAGES,
  onLanguageChange,
  saveLanguage,
  t,
  type Lang,
} from "@browserail/i18n";
import { isExportedSettingsData } from "@browserail/protocol";
import { chooseTransferOptions } from "./components/transfer-options";
import { selectTransferData } from "./transfer";
import { createOptionsState } from "./state";
import { loadOptions, createPersistence } from "./persistence";
import { createBookmarkLibrary } from "./bookmark-library";
import { createCustomBookmarkSource } from "./custom-bookmark-source";
import { createBookmarkPicker } from "./components/bookmark-picker";
import { createCustomBookmarkPicker } from "./components/custom-bookmark-picker";
import { createColorPopover } from "./components/color-popover";
import { createBookmarkTools } from "./components/bookmark-tools";
import { createOverlays } from "./components/overlays";
import { createSiteAuthorization } from "./components/site-authorization";
import { mountExternalAuthorization } from "./components/external-authorization";
import { mountRuntimeControls } from "./components/runtime-controls";
import { mountStartTab } from "./tabs/start";
import { mountInstanceTab } from "./tabs/instance";
import { mountMenusTab } from "./tabs/menus";
import { mountCustomBookmarksTab } from "./tabs/custom-bookmarks";
import { mountShortcutsTab } from "./tabs/shortcuts";
import { mountUrlMatchingTab } from "./tabs/url-matching";
import { element } from "./dom";
import { createScope } from "./lifecycle";
import { normalizeDynamicBookmarks, type UrlRule } from "../../config";
import { cloudStorageAvailable, uploadCloudSettings, downloadCloudSettings } from "../../config/cloud-storage";

export async function mountOptionsPage() {
  const scope = createScope();
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) scope.destroy();
    },
    { signal: scope.signal },
  );
  applyStaticI18n();
  const status = element<HTMLOutputElement>("status");
  const connectionForm = element<HTMLFormElement>("connection-form");
  const menusForm = element<HTMLFormElement>("menus-form");
  const content = element<HTMLDivElement>("settings-content");
  const save = element<HTMLButtonElement>("save-btn");
  const saveBar = element<HTMLElement>("settings-save-bar");
  const transfers = element<HTMLElement>("settings-transfer-actions");
  const importFile = element<HTMLInputElement>("import-file-input");
  const language = element<HTMLSelectElement>("language-select");
  const cloudUpload = element<HTMLButtonElement>("cloud-upload");
  const cloudDownload = element<HTMLButtonElement>("cloud-download");
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".menus-card-tab"));
  let activePanel = "start-panel";
  let saving = false;
  const showStatus = (message: string) => {
    if (!scope.signal.aborted) status.value = message;
  };
  const flash = (message: string, delay: number) => {
    showStatus(message);
    scope.timeout(() => {
      if (status.value === message) status.value = "";
    }, delay);
  };
  const loaded = await loadOptions();
  if (scope.signal.aborted) return { destroy: scope.destroy };
  const state = createOptionsState(loaded.instance, loaded.settings);
  const library = createBookmarkLibrary(() => state.instance.rootPrefix);
  library.initialize(loaded.tree, loaded.bookmarksAvailable);
  element("bookmarks-unsupported-notice").hidden = loaded.bookmarksAvailable;
  const source = createCustomBookmarkSource(state);
  scope.add(source.destroy);
  const persistence = createPersistence(state, library);
  scope.add(persistence.destroy);
  const overlays = createOverlays();
  const bookmarkPicker = createBookmarkPicker(library);
  const customPicker = createCustomBookmarkPicker();
  const color = createColorPopover(overlays);
  scope.add(bookmarkPicker.destroy);
  scope.add(customPicker.destroy);
  scope.add(color.destroy);
  const tools = createBookmarkTools(state, library, bookmarkPicker);
  scope.add(tools.destroy);
  const authorization = createSiteAuthorization({
    root: element("site-authorization-controls"),
    warning: element("site-authorization-warning"),
    getMode: () => state.instance.displayMode,
    getUserscriptEnabled: () => state.instance.externalAuthorization.userscriptEnabled,
    getRules: () => structuredClone(state.settings.urlRules) as UrlRule[],
    hasUnsavedRules: () => state.dirty.settings,
  });
  scope.add(authorization.destroy);
  const runtime = mountRuntimeControls(loaded.enabled);
  const start = mountStartTab();
  const instance = mountInstanceTab(state, library, bookmarkPicker, loaded.enabled);
  const externalAuthorization = mountExternalAuthorization(state);
  const menus = mountMenusTab(
    state,
    library,
    source,
    bookmarkPicker,
    customPicker,
    color,
    overlays,
    persistence,
    showStatus,
  );
  const custom = mountCustomBookmarksTab(state, source, tools, overlays, showStatus);
  const shortcuts = mountShortcutsTab(
    state,
    library,
    source,
    bookmarkPicker,
    customPicker,
    overlays,
    showStatus,
  );
  const rules = mountUrlMatchingTab(state);
  const views = [runtime, start, instance, externalAuthorization, menus, custom, shortcuts, rules];
  for (const view of views) scope.add(view.destroy);
  function renderNativeHints(): void {
    for (const hint of document.querySelectorAll<HTMLElement>("[data-native-only]"))
      hint.hidden = state.savedDisplayMode !== "browser";
  }
  function updateSave(): void {
    saveBar.hidden = activePanel === "start-panel";
    const instancePanel = activePanel === "connection-form";
    const key = instancePanel ? "btn.saveInstance" : "btn.saveSettings";
    save.dataset.i18n = key;
    save.textContent = t(key);
    save.setAttribute("form", instancePanel ? connectionForm.id : menusForm.id);
    save.classList.toggle("is-dirty", instancePanel ? state.dirty.instance : state.dirty.settings);
    save.disabled = saving;
    cloudUpload.disabled = cloudDownload.disabled = saving || !cloudStorageAvailable();
    cloudUpload.title = cloudDownload.title = cloudStorageAvailable() ? "" : t("cloud.unavailable");
    transfers.hidden = instancePanel;
    for (const tab of tabs) tab.disabled = saving;
  }
  function showPanel(id: string): void {
    activePanel = id;
    for (const tab of tabs) {
      const panelId = tab.dataset.tabTarget;
      if (!panelId) continue;
      tab.setAttribute("aria-selected", String(panelId === id));
      document.getElementById(panelId)?.toggleAttribute("hidden", panelId !== id);
    }
    menusForm.hidden = id === "connection-form" || id === "start-panel";
    content.scrollTop = 0;
    status.value = "";
    updateSave();
  }
  function validateSettings(): boolean {
    const unbound = state.settings.dynamicBookmarks.find((db) =>
      !state.settings.urlRules.some((rule) => rule.uid === db.urlRuleUid));
    if (!unbound) return true;
    showStatus(t("dynamic.saveNeedsRule", { name: unbound.name }));
    return false;
  }
  async function saveCurrent(): Promise<void> {
    if (saving || activePanel === "start-panel") return;
    const instancePanel = activePanel === "connection-form";
    if (instancePanel && !instance.validate()) return;
    if (!instancePanel && !validateSettings()) return;
    saving = true;
    updateSave();
    try {
      const savedRules = await (instancePanel
        ? persistence.saveInstance()
        : persistence.saveSettings());
      authorization.refresh(savedRules);
      if (instancePanel) await instance.refresh();
      flash(t("status.saved"), 1500);
    } catch (error) {
      showStatus(t("status.saveFailed", { error: String(error) }));
    } finally {
      saving = false;
      if (!scope.signal.aborted) updateSave();
    }
  }
  async function transferCloud(direction: "upload" | "download"): Promise<void> {
    if (saving || !cloudStorageAvailable()) return;
    if (state.dirty.instance || direction === "upload" && state.dirty.settings) {
      flash(t("export.saveFirst"), 3000);
      return;
    }
    saving = true;
    updateSave();
    try {
      if (direction === "upload") {
        if (!window.confirm(t("cloud.uploadConfirm"))) return;
        showStatus(t("cloud.uploading"));
        await uploadCloudSettings(await persistence.exportSettings());
        flash(t("cloud.uploaded"), 2000);
      } else {
        showStatus(t("cloud.downloading"));
        const data = await downloadCloudSettings();
        if (scope.signal.aborted) return;
        const hasRewrites = normalizeDynamicBookmarks(data.dynamicBookmarks).some(db => db.type === "rewrite");
        let includeRewrites = false;
        if (hasRewrites) {
          const options = await chooseTransferOptions("cloudDownload", data);
          if (!options || scope.signal.aborted) return;
          includeRewrites = options.includeRewrites;
        } else if (!window.confirm(t("cloud.downloadConfirm"))) return;
        await persistence.importSettings(JSON.stringify(data), { includeRewrites });
        if (!validateSettings()) return;
        const rules = await persistence.saveSettings();
        authorization.refresh(rules);
        flash(t("cloud.downloaded"), 2000);
      }
    } catch (error) {
      showStatus(t("cloud.failed", { error: String(error) }));
    } finally {
      saving = false;
      if (status.value === t("cloud.downloading") || status.value === t("cloud.uploading")) showStatus("");
      if (!scope.signal.aborted) updateSave();
    }
  }
  cloudUpload.addEventListener("click", () => void transferCloud("upload"), { signal: scope.signal });
  cloudDownload.addEventListener("click", () => void transferCloud("download"), { signal: scope.signal });
  for (const form of [connectionForm, menusForm])
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        void saveCurrent();
      },
      { signal: scope.signal },
    );
  for (const tab of tabs)
    tab.addEventListener(
      "click",
      () => {
        const id = tab.dataset.tabTarget;
        if (!id || id === activePanel || saving) return;
        if (activePanel === "connection-form" && state.dirty.instance) {
          if (!window.confirm(t("settings.discardInstance"))) return;
          instance.discard();
        }
        overlays.closeExcept();
        showPanel(id);
      },
      { signal: scope.signal },
    );
  content.addEventListener(
    "scroll",
    () => overlays.close("color", "addItem", "itemSettings", "shortcutSettings", "shortcutPick"),
    { signal: scope.signal },
  );
  window.addEventListener(
    "beforeunload",
    (event) => {
      if (state.dirty.instance || state.dirty.settings) {
        event.preventDefault();
        event.returnValue = "";
      }
    },
    { signal: scope.signal },
  );
  element("export-btn").addEventListener(
    "click",
    async () => {
      if (state.dirty.settings) {
        flash(t("export.saveFirst"), 3000);
        return;
      }
      const complete = await persistence.exportSettings({ bars: true });
      const options = await chooseTransferOptions("export", complete);
      if (!options || scope.signal.aborted) return;
      const data = selectTransferData(complete, options);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      const now = new Date();
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      link.href = url;
      link.download = `browserail-menus-${date}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      flash(t("export.exported"), 2500);
    },
    { signal: scope.signal },
  );
  element("import-btn").addEventListener(
    "click",
    () => {
      if (state.dirty.settings && !window.confirm(t("import.confirmOverwrite"))) return;
      importFile.value = "";
      importFile.click();
    },
    { signal: scope.signal },
  );
  importFile.addEventListener(
    "change",
    () => {
      const file = importFile.files?.[0];
      if (!file) return;
      void file
        .text()
        .then(async (text) => {
          if (scope.signal.aborted) return;
          const parsed: unknown = JSON.parse(text);
          if (!isExportedSettingsData(parsed)) throw new Error(t("import.invalidJson"));
          const options = await chooseTransferOptions("import", parsed);
          if (!options || scope.signal.aborted) return;
          await persistence.importSettings(text, options);
          flash(t("import.savedOk"), 3000);
        })
        .catch((error) => showStatus(t("import.failed", { error: String(error) })));
    },
    { signal: scope.signal },
  );
  function renderLanguage(): void {
    language.replaceChildren(
      ...LANGUAGES.map((lang) => {
        const option = document.createElement("option");
        option.value = lang;
        option.textContent = lang === "zh-CN" ? t("language.zhCN") : t("language.en");
        return option;
      }),
    );
    language.value = getLanguage();
  }
  language.addEventListener("change", () => void saveLanguage(language.value as Lang), {
    signal: scope.signal,
  });
  scope.add(
    onLanguageChange(() => {
      overlays.close("addItem");
      applyStaticI18n();
      renderLanguage();
      for (const view of views) view.render();
      updateSave();
      renderNativeHints();
      bookmarkPicker.refresh();
      tools.render();
    }),
  );
  scope.add(state.subscribe(["dirty"], updateSave));
  const accessSettings = () => {
    const { displayMode, externalAuthorization } = state.instance;
    return `${displayMode}:${externalAuthorization.extensionsEnabled}:${externalAuthorization.userscriptEnabled}`;
  };
  let previousAccessSettings = accessSettings();
  scope.add(
    state.subscribe(["instance"], () => {
      renderNativeHints();
      const current = accessSettings();
      if (current !== previousAccessSettings) {
        previousAccessSettings = current;
        authorization.refresh();
      } else authorization.render();
    }),
  );
  renderLanguage();
  renderNativeHints();
  authorization.refresh(loaded.settings.urlRules);
  void source.refreshTemporary();
  showPanel(state.settings.menus.length ? "connection-form" : "start-panel");
  return { destroy: scope.destroy };
}
