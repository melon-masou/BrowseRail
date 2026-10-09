import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import {
  normalizeItemIcon,
  EXPORT_SCHEMA_VERSION,
  isExportedSettingsData,
  isCustomBookmarkType,
  isShortcutActionType,
  normalizeBarConfigurations,
  type ExportedSettingsData,
  type ExportedMenuItem,
  ALL_URLS_RULE_UID,
} from "@browserail/protocol";
import {
  loadBookmarkRootPrefix,
  loadDisplayMode,
  loadWidgetEnabled,
  loadConfig,
  loadBarConfigurations,
  importBarConfigurations,
  saveConfig,
  saveBookmarkRootPrefix,
  saveDisplayMode,
  pruneTemporaryValues,
  normalizeConfig,
  normalizeUrlRules,
  normalizeDynamicBookmarks,
  normalizeStaticBookmarks,
  normalizeTemporaryBookmarks,
  normalizeExternalActions,
  normalizeUserVariables,
  normalizeGlobalCss,
  normalizeMenu,
  normalizeStoredMenuItem,
  normalizeShortcutAction,
  type StoredMenu,
  type StoredMenuItem,
  type StoredMenuItemType,
  type StoredShortcut,
  type StoredNativeShortcut,
  normalizeNativeShortcutSets,
  type UrlRule,
} from "../../lib/config";
import { canUseBookmarks } from "../../lib/browser/bookmarks-capability";
import { settingsFromConfig, type OptionsState, type SettingsDraft } from "./state";
import type { BookmarkLibrary } from "./bookmark-library";
import { createScope } from "./lifecycle";
import { hasTransferGroup, mergeByKey, selectTransferData, type TransferOptions } from "./transfer";
import { validateRewrite } from "../../lib/rewrite/rewrite";
import { loadExternalAuthorization, saveExternalAuthorization } from "../../lib/config/external-authorization-store";
import { CONFIG_SAVED } from "../../lib/config/messages";
export async function loadOptions() {
  const bookmarksAvailable = await canUseBookmarks();
  const [config, enabled, tree, rootPrefix, displayMode, externalAuthorization] = await Promise.all([
    loadConfig(),
    loadWidgetEnabled(),
    bookmarksAvailable ? browser.bookmarks.getTree() : [],
    loadBookmarkRootPrefix(),
    loadDisplayMode(),
    loadExternalAuthorization(),
  ]);
  return {
    instance: {
      label: config.instanceLabel,
      desktopUrl: config.desktopWidget.url,
      displayMode,
      rootPrefix,
      externalAuthorization,
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

    const currentConfig = await loadConfig();
    await saveConfig({
      ...currentConfig,
      desktopWidget: {
        url: savingSettings.desktopUrl.trim(),
      },
      instanceLabel: savingSettings.label.trim(),
    });
    await saveDisplayMode(savingSettings.displayMode);
    await saveExternalAuthorization(structuredClone(savingSettings.externalAuthorization));
    await browser.runtime.sendMessage({ type: CONFIG_SAVED });
    state.acceptInstanceSave(savingSettings);
    return currentConfig.urlRules;
  }
  async function saveSettings(): Promise<UrlRule[]> {
    if (!state.userVariablesValid) throw new Error(t("variables.invalidKeys"));
    const submitted = state.settings;
    const saving = structuredClone(submitted) as SettingsDraft;
    const {
      menus,
      globalCss,
      urlRules,
      defaultUrlRuleUid,
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      externalActions,
      userVariables,
      shortcuts,
      nativeShortcutSets,
    } = saving;
    for (const bookmark of dynamicBookmarks) {
      if (bookmark.type !== "rewrite") continue;
      const error = validateRewrite(bookmark.rewrite ?? "");
      if (error) throw new Error(t("dynamic.invalidRewrite", { name: bookmark.name, error }));
    }
    for (const menu of menus) {
      library.enrich(menu.items, library.tree);
    }

    const currentConfig = await loadConfig();
    if (defaultUrlRuleUid) currentConfig.defaultUrlRuleUid = defaultUrlRuleUid;
    else delete currentConfig.defaultUrlRuleUid;
    delete currentConfig.globalCss;
    const savedRules = structuredClone(urlRules);
    await saveConfig({
      ...currentConfig,
      panel: {
        menus,
      },
      urlRules: savedRules,
      ...(globalCss ? { globalCss } : {}),
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      externalActions,
      userVariables,
      shortcuts,
      nativeShortcutSets,
    });
    if (saving.barConfigurations) await importBarConfigurations(saving.barConfigurations, menus.map(menu => menu.uid), saving.replaceBarConfigurations === true);
    await pruneTemporaryValues(temporaryBookmarks);
    await browser.runtime.sendMessage({ type: CONFIG_SAVED });
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
    await browser.runtime.sendMessage({ type: CONFIG_SAVED });
    return true;
  }
  async function exportSettings(options: Partial<TransferOptions> = {}): Promise<ExportedSettingsData> {
    if (options.bookmarks !== false && !state.userVariablesValid) throw new Error(t("variables.invalidKeys"));
    const {
      menus,
      globalCss,
      urlRules,
      defaultUrlRuleUid,
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      externalActions,
      userVariables,
      shortcuts,
      nativeShortcutSets,
    } = structuredClone(state.settings) as SettingsDraft;
    for (const menu of menus) {
      library.enrich(menu.items, library.tree);
    }

    // Runtime URLs/notes stay local; only definitions and references are portable.
    const barConfigurations = options.bars ? await loadBarConfigurations() : undefined;
    if (barConfigurations) {
      const uids = new Set(menus.map(menu => menu.uid));
      barConfigurations.native = Object.fromEntries(Object.entries(barConfigurations.native).filter(([uid]) => uids.has(uid)));
      barConfigurations.browser = Object.fromEntries(Object.entries(barConfigurations.browser).filter(([uid]) => uids.has(uid)));
    }
    const exportData: ExportedSettingsData = {
      version: EXPORT_SCHEMA_VERSION,
      ...(barConfigurations ? { barConfigurations } : {}),
      exportedAt: new Date().toISOString(),
      globalCss: globalCss ?? {},
      userVariables,
      urlRules,
      ...(defaultUrlRuleUid ? { defaultUrlRuleUid } : {}),
      dynamicBookmarks,
      staticBookmarks,
      temporaryBookmarks,
      externalActions,
      shortcuts,
      nativeShortcutSets,
      menus: menus.map((menu) => ({
        uid: menu.uid,
        ...(menu.style ? { style: menu.style } : {}),
        ...(menu.name ? { name: menu.name } : {}),
        ...(menu.urlRuleUids && menu.urlRuleUids.length > 0
          ? { urlRuleUids: menu.urlRuleUids }
          : {}),
        ...(menu.color ? { color: menu.color } : {}),
        ...(menu.dockColor ? { dockColor: menu.dockColor } : {}),
        ...(menu.cssClass ? { cssClass: menu.cssClass } : {}),
        items: menu.items.map((item) => {
          if (
            item.type === "menuFold" ||
            item.type === "menusToggle" ||
            item.type === "browserAction" ||
            item.type === "shortcutsToggle" ||
            item.type === "autoHideToggle"
          ) {
            return {
              uid: item.uid,
              ...(item.cssClass ? { cssClass: item.cssClass } : {}),
              ...(item.icon ? { icon: item.icon } : {}),
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
              ...(item.cssClass ? { cssClass: item.cssClass } : {}),
              ...(item.icon ? { icon: item.icon } : {}),
              type: "dynamic",
              ...(item.dynamicUid ? { dynamicUid: item.dynamicUid } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
            } satisfies ExportedMenuItem;
          }

          if (item.type === "staticTag" || item.type === "flattenStaticTag") {
            return {
              uid: item.uid,
              ...(item.cssClass ? { cssClass: item.cssClass } : {}),
              ...(item.icon ? { icon: item.icon } : {}),
              type: item.type,
              ...(item.staticTag ? { staticTag: item.staticTag } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
              ...(item.expandOnHover !== undefined ? { expandOnHover: item.expandOnHover } : {}),
            } satisfies ExportedMenuItem;
          }

          if (item.type === "temporary" || item.type === "static" || item.type === "externalAction") {
            return {
              uid: item.uid,
              ...(item.cssClass ? { cssClass: item.cssClass } : {}),
              ...(item.icon ? { icon: item.icon } : {}),
              type: item.type,
              ...(item.staticUid ? { staticUid: item.staticUid } : {}),
              ...(item.temporaryUid ? { temporaryUid: item.temporaryUid } : {}),
              ...(item.externalActionUid ? { externalActionUid: item.externalActionUid } : {}),
              ...(item.rename ? { rename: item.rename } : {}),
              ...(item.color ? { color: item.color } : {}),
            } satisfies ExportedMenuItem;
          }

          const path = item.path;
          const isFolder = item.type === "folder" || item.type === "flattenFolder";
          const itemType: string = item.type ?? (isFolder ? "folder" : "bookmark");

          const exportedItem: ExportedMenuItem = {
            uid: item.uid,
            ...(item.cssClass ? { cssClass: item.cssClass } : {}),
            ...(item.icon ? { icon: item.icon } : {}),
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
          };
          return exportedItem;
        }),
      })),
    };

    return selectTransferData(exportData, options);
  }
  async function importSettings(text: string, options: Partial<TransferOptions> = {}): Promise<void> {
    const source = JSON.parse(text) as unknown;
    if (!isExportedSettingsData(source)) {
      throw new Error(t("import.invalidJson"));
    }

    const parsed = selectTransferData(source, { ...options, bars: options.bars ?? false });
    const includeRewrites = options.includeRewrites ?? false;
    const importsMenus = hasTransferGroup(parsed, "menus");
    const importsBookmarks = hasTransferGroup(parsed, "bookmarks");
    const runtimeMenus = (await loadConfig()).panel.menus;
    const imported = structuredClone(state.settings) as SettingsDraft;
    const replacing = options.mode === "replace";
    if (replacing) {
      if (importsMenus) { imported.menus = []; delete imported.globalCss; }
      if (hasTransferGroup(parsed, "urlRules")) { imported.urlRules = []; delete imported.defaultUrlRuleUid; }
      if (importsBookmarks) {
        imported.staticBookmarks = [];
        imported.dynamicBookmarks = [];
        imported.temporaryBookmarks = [];
        imported.externalActions = [];
        imported.userVariables = {};
      }
      if (hasTransferGroup(parsed, "shortcuts")) { imported.shortcuts = []; imported.nativeShortcutSets = []; }
    }
    if (parsed.barConfigurations) {
      const incoming = normalizeBarConfigurations(parsed.barConfigurations);
      if (replacing) imported.replaceBarConfigurations = true;
      imported.barConfigurations = replacing ? incoming : {
        native: { ...imported.barConfigurations?.native, ...incoming.native },
        browser: { ...imported.barConfigurations?.browser, ...incoming.browser },
      };
    }
    const menusSource = parsed.menus ?? [];

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

        const icon = normalizeItemIcon(itemRecord.icon);
        const cssClass = typeof itemRecord.cssClass === "string" ? itemRecord.cssClass.trim() : "";

        const cycleColors = Array.isArray(itemRecord.cycleColors)
          ? itemRecord.cycleColors.filter((c): c is string => typeof c === "string" && Boolean(c))
          : undefined;

        if (
          type === "menusToggle" ||
          type === "browserAction" ||
          type === "shortcutsToggle" ||
          type === "autoHideToggle" ||
          type === "static" ||
          type === "staticTag" ||
          type === "flattenStaticTag" ||
          type === "temporary" ||
          type === "externalAction"
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
            ...(cssClass ? { cssClass } : {}),
            ...(icon ? { icon } : {}),
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
          ...(cssClass ? { cssClass } : {}),
          ...(icon ? { icon } : {}),
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
          ...(type === "dynamic" &&
          typeof itemRecord.dynamicUid === "string" &&
          itemRecord.dynamicUid
            ? { dynamicUid: itemRecord.dynamicUid }
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
    if (importsMenus) {
      const globalCss = { ...imported.globalCss, ...normalizeGlobalCss(parsed.globalCss) };
      if (Object.keys(globalCss).length) imported.globalCss = globalCss;
      else delete imported.globalCss;
    }
    if (importsBookmarks) {
      imported.staticBookmarks = mergeByKey(imported.staticBookmarks, normalizeStaticBookmarks(parsed.staticBookmarks), bookmark => bookmark.uid);
      imported.temporaryBookmarks = mergeByKey(imported.temporaryBookmarks, normalizeTemporaryBookmarks(parsed.temporaryBookmarks), bookmark => bookmark.uid);
      imported.userVariables = { ...imported.userVariables, ...normalizeUserVariables(parsed.userVariables) };
    }

    if (Array.isArray(parsed.urlRules)) {
      imported.urlRules = mergeByKey(imported.urlRules, normalizeUrlRules(parsed.urlRules), rule => rule.uid);
    }
    if (
      typeof parsed.defaultUrlRuleUid === "string" &&
      imported.urlRules.some(rule => rule.uid === parsed.defaultUrlRuleUid)
    ) imported.defaultUrlRuleUid = parsed.defaultUrlRuleUid;

    if (importsBookmarks) {
      // Retained local rules must match the file's scope; a shared uid alone is insufficient.
      const fileRuleUids = new Set(normalizeUrlRules(source.urlRules)
        .filter(rule => imported.urlRules.some(local => local.uid === rule.uid && JSON.stringify(local.patterns) === JSON.stringify(rule.patterns)))
        .map(rule => rule.uid));
      const incoming = normalizeDynamicBookmarks(parsed.dynamicBookmarks).flatMap(({ urlRuleUid, ...db }) => {
        if (!includeRewrites && db.type === "rewrite") return [];
        return [{
          ...db,
          ...(!includeRewrites && db.rewrite !== undefined ? { rewrite: "" } : {}),
          ...(urlRuleUid && fileRuleUids.has(urlRuleUid) ? { urlRuleUid } : {}),
        }];
      });
      imported.dynamicBookmarks = mergeByKey(imported.dynamicBookmarks, incoming, bookmark => bookmark.uid);
      const actions = normalizeExternalActions(parsed.externalActions).map(({ urlRuleUid, ...action }) => ({
        ...action,
        ...(urlRuleUid && (urlRuleUid === ALL_URLS_RULE_UID || fileRuleUids.has(urlRuleUid)) ? { urlRuleUid } : {}),
      }));
      imported.externalActions = mergeByKey(imported.externalActions, actions, action => action.uid);
    }
    let incomingShortcuts: StoredShortcut[] = [];
    if (Array.isArray(parsed.shortcuts)) {
      incomingShortcuts = parsed.shortcuts.flatMap((sc): StoredShortcut[] => {
        if (typeof sc !== "object" || sc === null) return [];
        const record = sc as unknown as Record<string, unknown>;
        if (typeof record.slot !== "string") return [];
        if (isShortcutActionType(record.type)) {
          const action = normalizeShortcutAction(record);
          return action ? [{ slot: record.slot, ...action }] : [];
        }
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
            ...(typeof record.externalActionUid === "string" ? { externalActionUid: record.externalActionUid } : {}),
            ...(record.tabMode === "newTab" || record.tabMode === "replace"
              ? { tabMode: record.tabMode }
              : {}),
          },
        ];
      });
    }
    const importedDynamicUids = new Set(imported.dynamicBookmarks.map(db => db.uid));
    const keepReference = (item: StoredMenuItem | StoredShortcut | StoredNativeShortcut): boolean =>
      item.type !== "dynamic" || !!item.dynamicUid && importedDynamicUids.has(item.dynamicUid);
    if (parsed.menus) {
      if (importsBookmarks) for (const menu of importedMenus) menu.items = menu.items.filter(keepReference);
      imported.menus = mergeByKey(imported.menus, importedMenus, menu => menu.uid);
    }
    if (parsed.shortcuts) imported.shortcuts = mergeByKey(imported.shortcuts, importsBookmarks ? incomingShortcuts.filter(keepReference) : incomingShortcuts, shortcut => shortcut.slot);
    if (parsed.nativeShortcutSets) {
      const incoming = normalizeNativeShortcutSets(parsed.nativeShortcutSets).map(set => ({
        ...set, shortcuts: importsBookmarks ? set.shortcuts.filter(keepReference) : set.shortcuts,
      }));
      imported.nativeShortcutSets = mergeByKey(imported.nativeShortcutSets, incoming, set => set.uid);
    }
    state.importSettings(imported, parsed.userVariables !== undefined || replacing && importsBookmarks);
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
