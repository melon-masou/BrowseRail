import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import {
  EXPORT_SCHEMA_VERSION,
  isExportedSettingsData,
  isCustomBookmarkType,
  normalizeBarConfigurations,
  type ExportedSettingsData,
  type ExportedMenuItem,
} from "@browserail/protocol";
import {
  loadBookmarkRootPrefix,
  loadDisplayMode,
  loadSyncEnabled,
  loadWidgetEnabled,
  loadConfig,
  loadBarConfigurations,
  importBarConfigurations,
  saveConfig,
  saveBookmarkRootPrefix,
  saveSyncEnabled,
  saveDisplayMode,
  pruneTemporaryValues,
  normalizeConfig,
  normalizeUrlRules,
  normalizeDynamicBookmarks,
  normalizeStaticBookmarks,
  normalizeTemporaryBookmarks,
  normalizeMenu,
  normalizeStoredMenuItem,
  type StoredMenu,
  type StoredMenuItem,
  type StoredMenuItemType,
  type StoredShortcut,
  type StoredNativeShortcut,
  type UrlRule,
} from "../../config";
import { canUseBookmarks } from "../../browser/bookmarks-capability";
import { settingsFromConfig, type OptionsState, type SettingsDraft } from "./state";
import type { BookmarkLibrary } from "./bookmark-library";
import { createScope } from "./lifecycle";
export async function loadOptions() {
  const bookmarksAvailable = await canUseBookmarks();
  const [config, enabled, tree, rootPrefix, displayMode, syncEnabled] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    bookmarksAvailable ? browser.bookmarks.getTree() : [],
    loadBookmarkRootPrefix(),
    loadDisplayMode(),
    loadSyncEnabled(),
  ]);
  return {
    instance: {
      label: config.instanceLabel,
      desktopUrl: config.desktopWidget.url,
      displayMode,
      rootPrefix,
      syncEnabled,
    },
    settings: settingsFromConfig(config),
    enabled,
    tree,
    bookmarksAvailable,
  };
}
export function createPersistence(state: OptionsState, library: BookmarkLibrary) {
  const scope = createScope();
  async function saveInstance(): Promise<UrlRule[]> {
    const savingSettings = structuredClone(state.instance);
    await saveBookmarkRootPrefix([...savingSettings.rootPrefix]);

    await saveSyncEnabled(savingSettings.syncEnabled);

    const currentConfig = await loadConfig();
    await saveConfig({
      ...currentConfig,
      desktopWidget: {
        url: savingSettings.desktopUrl.trim(),
      },
      instanceLabel: savingSettings.label.trim(),
    });
    await saveDisplayMode(savingSettings.displayMode);
    await browser.runtime.sendMessage({ type: "configSaved" });
    state.acceptInstanceSave(savingSettings);
    return currentConfig.urlRules;
  }
  async function saveSettings(): Promise<UrlRule[]> {
    const submitted = state.settings;
    const saving = structuredClone(submitted) as SettingsDraft;
    const {
      menus,
      urlRules,
      defaultUrlRuleUid,
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      shortcuts,
      nativeShortcuts,
    } = saving;
    for (const menu of menus) {
      library.enrich(menu.items, library.tree);
    }

    const currentConfig = await loadConfig();
    if (defaultUrlRuleUid) currentConfig.defaultUrlRuleUid = defaultUrlRuleUid;
    else delete currentConfig.defaultUrlRuleUid;
    const savedRules = structuredClone(urlRules);
    await saveConfig({
      ...currentConfig,
      panel: {
        menus,
      },
      urlRules: savedRules,
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      shortcuts,
      nativeShortcuts,
    });
    if (saving.barConfigurations) await importBarConfigurations(saving.barConfigurations, menus.map(menu => menu.uid));
    await pruneTemporaryValues(temporaryBookmarks);
    await browser.runtime.sendMessage({ type: "configSaved" });
    state.acceptSettingsSave(submitted);
    return savedRules;
  }
  async function saveMenuEnabled(menuUid: string, enabled: boolean): Promise<boolean> {
    const currentConfig = await loadConfig();
    if (!currentConfig.panel.menus.some((storedMenu) => storedMenu.uid === menuUid)) {
      return false;
    }

    await saveConfig({
      ...currentConfig,
      panel: {
        menus: currentConfig.panel.menus.map((storedMenu) =>
          storedMenu.uid === menuUid ? { ...storedMenu, enabled } : storedMenu,
        ),
      },
    });
    await browser.runtime.sendMessage({ type: "configSaved" });
    return true;
  }
  async function exportSettings(includeBars = false): Promise<ExportedSettingsData> {
    const {
      menus,
      urlRules,
      defaultUrlRuleUid,
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      shortcuts,
      nativeShortcuts,
    } = structuredClone(state.settings) as SettingsDraft;
    for (const menu of menus) {
      library.enrich(menu.items, library.tree);
    }

    // Runtime URLs/notes stay local; only definitions and references are portable.
    const barConfigurations = includeBars ? await loadBarConfigurations() : undefined;
    if (barConfigurations) {
      const uids = new Set(menus.map(menu => menu.uid));
      barConfigurations.native = Object.fromEntries(Object.entries(barConfigurations.native).filter(([uid]) => uids.has(uid)));
      barConfigurations.browser = Object.fromEntries(Object.entries(barConfigurations.browser).filter(([uid]) => uids.has(uid)));
    }
    const exportData: ExportedSettingsData = {
      version: EXPORT_SCHEMA_VERSION,
      ...(barConfigurations ? { barConfigurations } : {}),
      exportedAt: new Date().toISOString(),
      ...(urlRules.length > 0 ? { urlRules: structuredClone(urlRules) } : {}),
      ...(defaultUrlRuleUid ? { defaultUrlRuleUid } : {}),
      ...(dynamicBookmarks.length > 0
        ? { dynamicBookmarks: structuredClone(dynamicBookmarks) }
        : {}),
      ...(staticBookmarks.length > 0 ? { staticBookmarks: structuredClone(staticBookmarks) } : {}),
      ...(temporaryBookmarks.length > 0
        ? { temporaryBookmarks: structuredClone(temporaryBookmarks) }
        : {}),
      ...(shortcuts.length > 0 ? { shortcuts: structuredClone(shortcuts) } : {}),
      ...(nativeShortcuts.length > 0 ? { nativeShortcuts: structuredClone(nativeShortcuts) } : {}),
      menus: menus.map((menu) => ({
        uid: menu.uid,
        ...(menu.urlRuleUids && menu.urlRuleUids.length > 0
          ? { urlRuleUids: menu.urlRuleUids }
          : {}),
        ...(menu.color ? { color: menu.color } : {}),
        ...(menu.dockColor ? { dockColor: menu.dockColor } : {}),
        ...(menu.tabMode ? { tabMode: menu.tabMode } : {}),
        items: menu.items.map((item) => {
          if (
            item.type === "menuFold" ||
            item.type === "menusToggle" ||
            item.type === "browserAction"
          ) {
            return {
              uid: item.uid,
              type: item.type,
              ...(item.type === "browserAction" ? { browserAction: item.browserAction } : {}),
              ...(item.type === "menusToggle" ? { targetMenuUids: item.targetMenuUids ?? [] } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
            } satisfies ExportedMenuItem;
          }

          if (item.type === "dynamic") {
            return {
              uid: item.uid,
              type: "dynamic",
              ...(item.dynamicUid ? { dynamicUid: item.dynamicUid } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
              ...(item.tabMode ? { tabMode: item.tabMode } : {}),
              ...(item.showPageTitle ? { showPageTitle: true } : {}),
            } satisfies ExportedMenuItem;
          }

          if (item.type === "temporary" || item.type === "static") {
            return {
              uid: item.uid,
              type: item.type,
              ...(item.staticUid ? { staticUid: item.staticUid } : {}),
              ...(item.temporaryUid ? { temporaryUid: item.temporaryUid } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
              ...(item.tabMode ? { tabMode: item.tabMode } : {}),
            } satisfies ExportedMenuItem;
          }

          const path = item.path;
          const isFolder = item.type === "folder" || item.type === "flattenFolder";
          const itemType: string = item.type ?? (isFolder ? "folder" : "bookmark");

          const exportedItem: ExportedMenuItem = {
            uid: item.uid,
            type: itemType,
            ...(path !== undefined ? { path } : {}),
            ...(item.url ? { url: item.url } : {}),
            ...(item.rename ? { rename: item.rename } : {}),
            ...(itemType === "flattenFolder"
              ? item.cycleColors && item.cycleColors.length > 0
                ? { cycleColors: item.cycleColors }
                : {}
              : item.color
                ? { color: item.color }
                : {}),
            ...(item.expandOnHover !== undefined ? { expandOnHover: item.expandOnHover } : {}),
            ...(item.includeFolders ? { includeFolders: true } : {}),
            ...(item.tabMode ? { tabMode: item.tabMode } : {}),
          };
          return exportedItem;
        }),
      })),
    };

    return exportData;
  }
  async function importSettings(text: string, includeBars = false): Promise<void> {
    const parsed = JSON.parse(text) as unknown;
    if (!isExportedSettingsData(parsed)) {
      throw new Error(t("import.invalidJson"));
    }

    const runtimeMenus = (await loadConfig()).panel.menus;
    const imported = structuredClone(state.settings) as SettingsDraft;
    delete imported.barConfigurations;
    if (includeBars && parsed.barConfigurations) imported.barConfigurations = normalizeBarConfigurations(parsed.barConfigurations);
    const menusSource = parsed.menus;

    // Rebuild each item from its portable fields.
    const importedMenus: StoredMenu[] = [];
    for (const rawMenu of menusSource) {
      if (typeof rawMenu !== "object" || rawMenu === null) continue;
      const menuRecord = rawMenu as unknown as Record<string, unknown>;
      const rawItems = Array.isArray(menuRecord.items) ? menuRecord.items : [];

      const items: StoredMenuItem[] = [];
      let hasMenuFold = false;
      for (const rawItem of rawItems) {
        if (typeof rawItem !== "object" || rawItem === null) continue;
        const itemRecord = rawItem as Record<string, unknown>;

        const path = Array.isArray(itemRecord.path)
          ? itemRecord.path.filter((p): p is string => typeof p === "string")
          : undefined;
        const type: StoredMenuItemType =
          typeof itemRecord.type === "string" && itemRecord.type ? itemRecord.type : "bookmark";
        const uid =
          typeof itemRecord.uid === "string" && itemRecord.uid
            ? itemRecord.uid
            : crypto.randomUUID();

        const rename =
          typeof itemRecord.rename === "string" && itemRecord.rename
            ? itemRecord.rename
            : undefined;

        const cycleColors = Array.isArray(itemRecord.cycleColors)
          ? itemRecord.cycleColors.filter((c): c is string => typeof c === "string" && Boolean(c))
          : undefined;

        if (
          type === "menusToggle" ||
          type === "browserAction" ||
          type === "static" ||
          type === "temporary"
        ) {
          const action = normalizeStoredMenuItem(itemRecord);
          if (action) items.push(action);
          continue;
        }

        if (type === "menuFold") {
          if (hasMenuFold) continue;
          hasMenuFold = true;
          items.push({
            uid,
            type: "menuFold",
            ...(rename ? { rename } : {}),
            ...(typeof itemRecord.color === "string" && itemRecord.color
              ? { color: itemRecord.color }
              : {}),
          });
          continue;
        }

        items.push({
          uid,
          type,
          ...(path !== undefined ? { path } : {}),
          ...(typeof itemRecord.url === "string" && itemRecord.url ? { url: itemRecord.url } : {}),
          ...(rename ? { rename } : {}),
          ...(type === "flattenFolder"
            ? cycleColors && cycleColors.length > 0
              ? { cycleColors }
              : {}
            : typeof itemRecord.color === "string" && itemRecord.color
              ? { color: itemRecord.color }
              : {}),
          ...(typeof itemRecord.expandOnHover === "boolean"
            ? { expandOnHover: itemRecord.expandOnHover }
            : {}),
          ...(itemRecord.includeFolders === true ? { includeFolders: true } : {}),
          ...(itemRecord.tabMode === "newTab" || itemRecord.tabMode === "replace"
            ? { tabMode: itemRecord.tabMode }
            : {}),
          ...(type === "dynamic" &&
          typeof itemRecord.dynamicUid === "string" &&
          itemRecord.dynamicUid
            ? { dynamicUid: itemRecord.dynamicUid }
            : {}),
          ...(type === "dynamic" && itemRecord.showPageTitle === true
            ? { showPageTitle: true }
            : {}),
        });
      }

      const normalizedMenu = normalizeMenu({
        ...menuRecord,
        uid:
          typeof menuRecord.uid === "string" && menuRecord.uid
            ? menuRecord.uid
            : crypto.randomUUID(),
        items,
      });
      if (normalizedMenu) {
        normalizedMenu.enabled = runtimeMenus.find(menu => menu.uid === normalizedMenu.uid)?.enabled ?? true;
        importedMenus.push(normalizedMenu);
      }
    }

    // Installation settings stay local when importing portable bookmark definitions.
    imported.menus = importedMenus;
    imported.staticBookmarks = normalizeStaticBookmarks(parsed.staticBookmarks);
    imported.temporaryBookmarks = normalizeTemporaryBookmarks(parsed.temporaryBookmarks);

    if (Array.isArray(parsed.urlRules)) {
      imported.urlRules = normalizeUrlRules(parsed.urlRules);
    }
    if (
      typeof parsed.defaultUrlRuleUid === "string" &&
      imported.urlRules.some((rule) => rule.uid === parsed.defaultUrlRuleUid)
    )
      imported.defaultUrlRuleUid = parsed.defaultUrlRuleUid;
    else delete imported.defaultUrlRuleUid;

    if (Array.isArray(parsed.dynamicBookmarks)) {
      imported.dynamicBookmarks = normalizeDynamicBookmarks(parsed.dynamicBookmarks);
    }
    if (Array.isArray(parsed.shortcuts)) {
      imported.shortcuts = parsed.shortcuts.flatMap((sc): StoredShortcut[] => {
        if (typeof sc !== "object" || sc === null) return [];
        const record = sc as unknown as Record<string, unknown>;
        if (typeof record.slot !== "string") return [];
        return [
          {
            slot: record.slot,
            type: isCustomBookmarkType(record.type) ? record.type : "bookmark",
            ...(Array.isArray(record.path)
              ? { path: record.path.filter((p): p is string => typeof p === "string") }
              : {}),
            ...(typeof record.url === "string" ? { url: record.url } : {}),
            ...(typeof record.title === "string" ? { title: record.title } : {}),
            ...(typeof record.dynamicUid === "string" ? { dynamicUid: record.dynamicUid } : {}),
            ...(typeof record.staticUid === "string" ? { staticUid: record.staticUid } : {}),
            ...(typeof record.temporaryUid === "string"
              ? { temporaryUid: record.temporaryUid }
              : {}),
            ...(record.tabMode === "newTab" || record.tabMode === "replace"
              ? { tabMode: record.tabMode }
              : {}),
          },
        ];
      });
    }
    if (Array.isArray(parsed.nativeShortcuts)) {
      imported.nativeShortcuts = parsed.nativeShortcuts.flatMap((sc): StoredNativeShortcut[] => {
        if (typeof sc !== "object" || sc === null) return [];
        const record = sc as unknown as Record<string, unknown>;
        if (typeof record.id !== "string" || !record.id) return [];
        return [
          {
            id: record.id,
            key: typeof record.key === "string" ? record.key : "",
            type: isCustomBookmarkType(record.type) ? record.type : "bookmark",
            ...(Array.isArray(record.path)
              ? { path: record.path.filter((p): p is string => typeof p === "string") }
              : {}),
            ...(typeof record.url === "string" ? { url: record.url } : {}),
            ...(typeof record.title === "string" ? { title: record.title } : {}),
            ...(typeof record.dynamicUid === "string" ? { dynamicUid: record.dynamicUid } : {}),
            ...(typeof record.staticUid === "string" ? { staticUid: record.staticUid } : {}),
            ...(typeof record.temporaryUid === "string"
              ? { temporaryUid: record.temporaryUid }
              : {}),
            ...(record.tabMode === "newTab" || record.tabMode === "replace"
              ? { tabMode: record.tabMode }
              : {}),
          },
        ];
      });
    }
    state.importSettings(imported);
  }

  const changed = (changes: Record<string, browser.Storage.StorageChange>, area: string): void => {
    if (area !== "local" || !changes.config?.newValue) return;
    state.receiveStoredConfig(
      normalizeConfig(changes.config.newValue, state.instance.label),
      normalizeConfig(changes.config.oldValue, state.instance.label),
    );
  };
  browser.storage.onChanged.addListener(changed);
  scope.add(() => browser.storage.onChanged.removeListener(changed));
  return {
    saveInstance,
    saveSettings,
    saveMenuEnabled,
    exportSettings,
    importSettings,
    destroy: scope.destroy,
  };
}
export type Persistence = ReturnType<typeof createPersistence>;
