import {
  customBookmarkReference,
  customBookmarkUid,
  DEFAULT_MENU_COLOR,
  isCustomBookmarkType,
  type CustomBookmarkType,
  type BarConfigurations,
  type TabMode,
  type JsonValue,
  type ShortcutAction,
  type ItemIcon,
} from "@browserail/protocol";
import type {
  DisplayMode,
  DynamicBookmark,
  ExtensionConfig,
  StoredMenu,
  StoredMenuItem,
  StoredShortcut,
  StoredNativeShortcut,
  UrlRule,
  StaticBookmark,
  TemporaryBookmark,
} from "../../config";
import { normalizeStaticBookmarkTags } from "../../config/static-bookmark-tags";
import { createExternalToken, type ExternalAuthorization } from "../../config/external-authorization";

export type ReadonlyData<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer E)[]
    ? readonly ReadonlyData<E>[]
    : T extends object
      ? { readonly [K in keyof T]: ReadonlyData<T[K]> }
      : T;
export interface InstanceSettings {
  label: string;
  desktopUrl: string;
  displayMode: DisplayMode;
  rootPrefix: string[];
  externalAuthorization: ExternalAuthorization;
}
export interface SettingsDraft {
  globalCss?: Record<string, string>;
  barConfigurations?: BarConfigurations;
  menus: StoredMenu[];
  urlRules: UrlRule[];
  defaultUrlRuleUid?: string;
  dynamicBookmarks: DynamicBookmark[];
  staticBookmarks: StaticBookmark[];
  temporaryBookmarks: TemporaryBookmark[];
  userVariables: Record<string, JsonValue>;
  shortcuts: StoredShortcut[];
  nativeShortcuts: StoredNativeShortcut[];
}
export interface UserVariable {
  uid: string;
  key: string;
  value: JsonValue;
}
export type StateArea = "instance" | "menus" | "rules" | "bookmarks" | "shortcuts" | "variables" | "dirty";
export interface StateChange {
  readonly areas: readonly StateArea[];
  readonly structural: boolean;
  readonly imported: boolean;
}
export type ShortcutId = { kind: "slot"; slot: string } | { kind: "native"; id: string };
export type ShortcutTarget =
  | { type: "bookmark"; path?: readonly string[]; url: string; title: string }
  | { type: CustomBookmarkType; uid: string }
  | ReadonlyData<ShortcutAction>;
type Editable<T> = { [K in keyof T]?: T[K] | undefined };
export type MenuAppearance = Editable<Pick<StoredMenu, "color" | "dockColor">>;
export type ItemBehavior = Editable<
  Pick<
    StoredMenuItem,
    | "rename"
    | "expandOnHover"
    | "includeFolders"
    | "targetMenuUids"
  >
>;
export type ColorId =
  | { kind: "menu"; uid: string; field: "color" | "dockColor" }
  | { kind: "item"; menuUid: string; uid: string };

function freeze<T>(value: T): ReadonlyData<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as ReadonlyData<T>;
}
function clone<T>(value: ReadonlyData<T>): T {
  return structuredClone(value) as T;
}
function requireTarget<T>(value: T | undefined, description: string): T {
  if (!value) throw new Error(`Unknown ${description}`);
  return value;
}
function setOptional<T extends object>(target: T, values: Editable<T>): void {
  for (const key of Object.keys(values) as (keyof T)[]) {
    if (values[key] === undefined) delete target[key];
    else target[key] = structuredClone(values[key]) as T[keyof T];
  }
}
export function settingsFromConfig(config: ExtensionConfig): SettingsDraft {
  return structuredClone({
    menus: config.panel.menus,
    ...(config.globalCss ? { globalCss: config.globalCss } : {}),
    urlRules: config.urlRules,
    ...(config.defaultUrlRuleUid ? { defaultUrlRuleUid: config.defaultUrlRuleUid } : {}),
    dynamicBookmarks: config.dynamicBookmarks,
    staticBookmarks: config.staticBookmarks,
    temporaryBookmarks: config.temporaryBookmarks,
    userVariables: config.userVariables,
    shortcuts: config.shortcuts,
    nativeShortcuts: config.nativeShortcuts,
  });
}

export function createOptionsState(instance: InstanceSettings, settings: SettingsDraft) {
  let instanceDraft = structuredClone(instance);
  let settingsDraft = structuredClone(settings);
  let savedInstance = structuredClone(instance);
  let savedSettings = structuredClone(settings);
  let instanceDirty = false;
  let settingsDirty = false;
  function variableRows(values: Record<string, JsonValue>): UserVariable[] {
    return Object.entries(values).map(([key, value]) => ({ uid: crypto.randomUUID(), key, value }));
  }
  let userVariableDrafts = variableRows(settingsDraft.userVariables);
  let userVariableSnapshot = freeze(structuredClone(userVariableDrafts));
  function userVariablesValid(): boolean {
    const keys = userVariableDrafts.map(row => row.key);
    return keys.every(key => key.trim().length > 0) && new Set(keys).size === keys.length;
  }
  function publishVariables(structural = false): void {
    if (userVariablesValid())
      settingsDraft.userVariables = Object.fromEntries(userVariableDrafts.map(row => [row.key, row.value]));
    userVariableSnapshot = freeze(structuredClone(userVariableDrafts));
    publish(["variables"], structural);
  }
  let instanceSnapshot = freeze(structuredClone(instanceDraft));
  let settingsSnapshot = freeze(structuredClone(settingsDraft));
  const listeners = new Set<(change: StateChange) => void>();
  function publish(areas: StateArea[], structural = false, edited = true, imported = false): void {
    if (edited) {
      if (areas.includes("instance")) instanceDirty = true;
      if (areas.some((area) => area !== "instance" && area !== "dirty")) settingsDirty = true;
    }
    if (areas.includes("instance")) instanceSnapshot = freeze(structuredClone(instanceDraft));
    if (areas.some((area) => area !== "instance" && area !== "dirty"))
      settingsSnapshot = freeze(structuredClone(settingsDraft));
    const change: StateChange = Object.freeze({
      areas: Object.freeze([...new Set([...areas, "dirty" as const])]),
      structural,
      imported,
    });
    for (const listener of [...listeners]) listener(change);
  }
  function menu(uid: string): StoredMenu {
    return requireTarget(
      settingsDraft.menus.find((value) => value.uid === uid),
      `menu ${uid}`,
    );
  }
  function item(menuUid: string, uid: string): StoredMenuItem {
    return requireTarget(
      menu(menuUid).items.find((value) => value.uid === uid),
      `menu item ${uid}`,
    );
  }
  function definitions(
    type: CustomBookmarkType,
  ): (StaticBookmark | TemporaryBookmark | DynamicBookmark)[] {
    return type === "static"
      ? settingsDraft.staticBookmarks
      : type === "temporary"
        ? settingsDraft.temporaryBookmarks
        : settingsDraft.dynamicBookmarks;
  }
  function definition(type: CustomBookmarkType, uid: string) {
    return requireTarget(
      definitions(type).find((value) => value.uid === uid),
      `${type} bookmark ${uid}`,
    );
  }
  function shortcut(id: ShortcutId): StoredShortcut | StoredNativeShortcut {
    return id.kind === "slot"
      ? requireTarget(
          settingsDraft.shortcuts.find((value) => value.slot === id.slot),
          `shortcut ${id.slot}`,
        )
      : requireTarget(
          settingsDraft.nativeShortcuts.find((value) => value.id === id.id),
          `native shortcut ${id.id}`,
        );
  }
  function ruleUids(uids: readonly string[]): string[] | undefined {
    for (const uid of uids)
      requireTarget(
        settingsDraft.urlRules.find((rule) => rule.uid === uid),
        `URL rule ${uid}`,
      );
    const result = [...new Set(uids)];
    return result.length ? result : undefined;
  }
  function colorTarget(id: ColorId) {
    return id.kind === "menu" ? menu(id.uid) : item(id.menuUid, id.uid);
  }
  return {
    get instance() {
      return instanceSnapshot;
    },
    get settings() {
      return settingsSnapshot;
    },
    get userVariables() {
      return userVariableSnapshot;
    },
    get userVariablesValid() {
      return userVariablesValid();
    },
    addUserVariable(): string {
      const uid = crypto.randomUUID();
      userVariableDrafts.push({ uid, key: "", value: "" });
      publishVariables(true);
      return uid;
    },
    editUserVariable(uid: string, values: Partial<Pick<UserVariable, "key" | "value">>): void {
      const row = requireTarget(userVariableDrafts.find(row => row.uid === uid), `variable ${uid}`);
      if (values.key !== undefined) row.key = values.key;
      if (values.value !== undefined) row.value = structuredClone(values.value);
      publishVariables();
    },
    removeUserVariable(uid: string): void {
      requireTarget(userVariableDrafts.find(row => row.uid === uid), `variable ${uid}`);
      userVariableDrafts = userVariableDrafts.filter(row => row.uid !== uid);
      publishVariables(true);
    },
    get savedDisplayMode() {
      return savedInstance.displayMode;
    },
    get savedUserscriptEnabled() {
      return savedInstance.externalAuthorization.userscriptEnabled;
    },
    get dirty() {
      return Object.freeze({ instance: instanceDirty, settings: settingsDirty });
    },
    subscribe(areas: readonly StateArea[], listener: (change: StateChange) => void): () => void {
      const filtered = (change: StateChange) => {
        if (change.areas.some((area) => areas.includes(area))) listener(change);
      };
      listeners.add(filtered);
      return () => {
        listeners.delete(filtered);
      };
    },
    editInstance(values: Partial<InstanceSettings>): void {
      setOptional(instanceDraft, values);
      if (values.rootPrefix)
        instanceDraft.rootPrefix = values.rootPrefix.map((value) => value.trim()).filter(Boolean);
      publish(["instance"]);
    },
    setExternalExtensionsEnabled(enabled: boolean): void {
      instanceDraft.externalAuthorization.extensionsEnabled = enabled;
      publish(["instance"]);
    },
    setExternalExtensionIds(text: string): void {
      instanceDraft.externalAuthorization.extensionIds = text.split("\n");
      publish(["instance"]);
    },
    setUserscriptEnabled(enabled: boolean): void {
      const authorization = instanceDraft.externalAuthorization;
      authorization.userscriptEnabled = enabled;
      if (enabled && !authorization.token) authorization.token = createExternalToken();
      publish(["instance"]);
    },
    regenerateExternalToken(): void {
      instanceDraft.externalAuthorization.token = createExternalToken();
      publish(["instance"]);
    },
    discardInstance(): void {
      instanceDraft = structuredClone(savedInstance);
      instanceDirty = false;
      publish(["instance"], false, false);
    },
    acceptInstanceSave(saved: ReadonlyData<InstanceSettings>): void {
      savedInstance = clone<InstanceSettings>(saved);
      instanceDirty = JSON.stringify(instanceDraft) !== JSON.stringify(savedInstance);
      publish(["instance"], false, false);
    },
    acceptSettingsSave(saved: ReadonlyData<SettingsDraft>): void {
      savedSettings = clone<SettingsDraft>(saved);
      if (JSON.stringify(settingsDraft.barConfigurations) === JSON.stringify(savedSettings.barConfigurations)) delete settingsDraft.barConfigurations;
      delete savedSettings.barConfigurations;
      settingsSnapshot = freeze(structuredClone(settingsDraft));
      settingsDirty = !userVariablesValid() || JSON.stringify(settingsDraft) !== JSON.stringify(savedSettings);
      publish(["dirty"], false, false);
    },
    importSettings(imported: SettingsDraft, importVariables = true): void {
      settingsDraft = structuredClone(imported);
      if (importVariables) {
        userVariableDrafts = variableRows(settingsDraft.userVariables);
        userVariableSnapshot = freeze(structuredClone(userVariableDrafts));
      }
      publish(["menus", "rules", "bookmarks", "shortcuts", "variables"], true, true, true);
    },
    receiveStoredConfig(stored: ExtensionConfig, previous: ExtensionConfig): void {
      const areas: StateArea[] = [];
      const added = stored.staticBookmarks.filter(
        (entry) =>
          !previous.staticBookmarks.some((old) => old.uid === entry.uid) &&
          !settingsDraft.staticBookmarks.some((draft) => draft.uid === entry.uid),
      );
      if (added.length) {
        settingsDraft.staticBookmarks.push(...structuredClone(added));
        areas.push("bookmarks");
      }
      for (const draft of settingsDraft.menus) {
        const saved = stored.panel.menus.find((value) => value.uid === draft.uid);
        if (saved && draft.enabled !== saved.enabled) {
          draft.enabled = saved.enabled !== false;
          areas.push("menus");
        }
      }
      if (areas.length) publish(areas, true, false);
    },
    addMenu(value: StoredMenu): void {
      if (settingsDraft.menus.some((existing) => existing.uid === value.uid))
        throw new Error(`Duplicate menu ${value.uid}`);
      settingsDraft.menus.push(structuredClone(value));
      publish(["menus"], true);
    },
    removeMenu(uid: string): void {
      menu(uid);
      settingsDraft.menus = settingsDraft.menus.filter((value) => value.uid !== uid);
      for (const target of settingsDraft.menus)
        for (const entry of target.items)
          if (entry.targetMenuUids)
            entry.targetMenuUids = entry.targetMenuUids.filter((value) => value !== uid);
      publish(["menus"], true);
    },
    setMenuEnabled(uid: string, enabled: boolean, saveMode: "immediate" | "withSettings"): void {
      menu(uid).enabled = enabled;
      publish(["menus"], false, saveMode === "withSettings");
    },
    addGlobalCss(name: string): string | undefined {
      const styles = settingsDraft.globalCss ?? {};
      const key = name.trim();
      if (!key || Object.hasOwn(styles, key)) return undefined;
      settingsDraft.globalCss = { ...styles, [key]: "" };
      publish(["menus"]);
      return key;
    },
    setGlobalCss(key: string, css: string): void {
      if (!settingsDraft.globalCss || !Object.hasOwn(settingsDraft.globalCss, key)) throw new Error(`Unknown CSS key: ${key}`);
      settingsDraft.globalCss = { ...settingsDraft.globalCss, [key]: css };
      publish(["menus"]);
    },
    removeGlobalCss(key: string): void {
      const entries = Object.entries(settingsDraft.globalCss ?? {}).filter(([entry]) => entry !== key);
      setOptional(settingsDraft, { globalCss: entries.length ? Object.fromEntries(entries) : undefined });
      publish(["menus"]);
    },
    setMenuName(uid: string, name: string): void {
      setOptional(menu(uid), { name: name.trim() || undefined });
      publish(["menus"]);
    },
    setMenuCssClass(uid: string, cssClass: string): void {
      setOptional(menu(uid), { cssClass: cssClass.trim() || undefined });
      publish(["menus"]);
    },
    setMenuStyle(uid: string, style: NonNullable<StoredMenu["style"]>): void {
      setOptional(menu(uid), { style: style === "text" ? undefined : style });
      publish(["menus"]);
    },
    setItemIcon(menuUid: string, itemUid: string, icon: ItemIcon | undefined): void {
      setOptional(item(menuUid, itemUid), { icon: icon ? structuredClone(icon) : undefined });
      publish(["menus"]);
    },
    setItemCssClass(menuUid: string, uid: string, cssClass: string): void {
      setOptional(item(menuUid, uid), { cssClass: cssClass.trim() || undefined });
      publish(["menus"]);
    },
    editMenuAppearance(uid: string, values: MenuAppearance): void {
      setOptional(menu(uid), values);
      publish(["menus"]);
    },
    setMenuRules(uid: string, uids: readonly string[]): void {
      setOptional(menu(uid), { urlRuleUids: ruleUids(uids) });
      publish(["menus"]);
    },
    addMenuItem(menuUid: string, value: StoredMenuItem): void {
      const target = menu(menuUid);
      if (
        value.type === "menuFold" &&
        target.items.some((existing) => existing.type === "menuFold")
      )
        throw new Error("Menu already has a fold action");
      if (target.items.some((existing) => existing.uid === value.uid))
        throw new Error(`Duplicate menu item ${value.uid}`);
      if (isCustomBookmarkType(value.type)) definition(value.type, customBookmarkUid(value) ?? "");
      target.items.push(structuredClone(value));
      publish(["menus"], true);
    },
    removeMenuItem(menuUid: string, uid: string): void {
      item(menuUid, uid);
      const target = menu(menuUid);
      target.items = target.items.filter((value) => value.uid !== uid);
      publish(["menus"], true);
    },
    moveMenuItem(menuUid: string, sourceIndex: number, targetIndex: number): void {
      const target = menu(menuUid);
      const value = requireTarget(target.items[sourceIndex], `menu item at ${sourceIndex}`);
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= target.items.length)
        throw new Error("Invalid menu item position");
      target.items.splice(sourceIndex, 1);
      target.items.splice(targetIndex, 0, value);
      publish(["menus"], true);
    },
    replaceBookmarkSource(
      menuUid: string,
      uid: string,
      source: Pick<StoredMenuItem, "type" | "path" | "url" | "expandOnHover" | "includeFolders">,
    ): void {
      const target = item(menuUid, uid);
      for (const key of ["type", "path", "url", "expandOnHover", "includeFolders"] as const)
        delete target[key];
      setOptional(target, source);
      publish(["menus"], true);
    },
    setStaticTagSource(menuUid: string, uid: string, tag: string): void {
      const target = item(menuUid, uid);
      if (target.type !== "staticTag" && target.type !== "flattenStaticTag")
        throw new Error("The item is not a static tag group");
      if (!settingsDraft.staticBookmarks.some(bookmark => bookmark.tags?.includes(tag)))
        throw new Error("The static tag is unavailable");
      if (target.staticTag === tag) return;
      target.staticTag = tag;
      publish(["menus"], true);
    },
    editItemBehavior(menuUid: string, uid: string, values: ItemBehavior): void {
      const target = item(menuUid, uid);
      const copy = structuredClone(values);
      if ("rename" in copy) copy.rename = copy.rename?.trim() || undefined;
      if (copy.targetMenuUids) {
        for (const targetUid of copy.targetMenuUids) {
          menu(targetUid);
          if (targetUid === menuUid) throw new Error("Menu cannot toggle itself");
        }
        copy.targetMenuUids = [...new Set(copy.targetMenuUids)];
      }
      setOptional(target, copy);
      publish(["menus"]);
    },
    setFolderFlattened(menuUid: string, uid: string, flattened: boolean): void {
      const target = item(menuUid, uid);
      if (target.type === "staticTag" || target.type === "flattenStaticTag") {
        target.type = flattened ? "flattenStaticTag" : "staticTag";
        publish(["menus"]);
        return;
      }
      if (target.type !== undefined && target.type !== "folder" && target.type !== "flattenFolder")
        throw new Error("Menu item is not a folder");
      target.type = flattened ? "flattenFolder" : "folder";
      if (flattened) delete target.color;
      else {
        delete target.includeFolders;
        delete target.cycleColors;
      }
      publish(["menus"]);
    },
    setColor(id: ColorId, value: string | undefined): void {
      // A menu always keeps a default color; clearing it resets to the default.
      const next = id.kind === "menu" && id.field === "color" ? value ?? DEFAULT_MENU_COLOR : value;
      setOptional(colorTarget(id), { [id.kind === "menu" ? id.field : "color"]: next });
      publish(["menus"]);
    },
    setCycleColors(id: Extract<ColorId, { kind: "item" }>, colors: readonly string[]): void {
      const target = item(id.menuUid, id.uid);
      if (target.type !== "flattenFolder")
        throw new Error("Cycle colors require a flattened folder");
      delete target.color;
      setOptional(target, { cycleColors: colors.length ? [...colors] : undefined });
      publish(["menus"]);
    },
    addBookmark(
      type: CustomBookmarkType,
      value: StaticBookmark | TemporaryBookmark | DynamicBookmark,
    ): void {
      if (definitions(type).some((existing) => existing.uid === value.uid))
        throw new Error(`Duplicate bookmark ${value.uid}`);
      if ((type === "static" && !("url" in value)) || (type === "dynamic" && !("type" in value)))
        throw new Error("Invalid bookmark definition");
      definitions(type).push(structuredClone(value));
      publish(["bookmarks"], true);
    },
    addStaticBookmarks(values: readonly StaticBookmark[]): void {
      if (!values.length) return;
      settingsDraft.staticBookmarks.push(...structuredClone(values));
      publish(["bookmarks"], true);
    },
    renameBookmark(type: CustomBookmarkType, uid: string, name: string): void {
      definition(type, uid).name = name;
      publish(["bookmarks", "menus", "shortcuts"]);
    },
    setStaticUrl(uid: string, url: string): void {
      const target = definition("static", uid);
      if (!("url" in target)) throw new Error("Not a static bookmark");
      target.url = url;
      publish(["bookmarks"]);
    },
    setStaticTags(uid: string, tags: readonly string[]): void {
      const target = requireTarget(settingsDraft.staticBookmarks.find(value => value.uid === uid), `static bookmark ${uid}`);
      const next = normalizeStaticBookmarkTags(tags);
      if (next.length === (target.tags?.length ?? 0) && next.every((tag, index) => tag === target.tags?.[index])) return;
      setOptional(target, { tags: next.length ? next : undefined });
      publish(["bookmarks"], true);
    },
    moveStaticBookmark(uid: string, targetUid: string, position: "before" | "after"): void {
      const bookmarks = settingsDraft.staticBookmarks;
      const source = requireTarget(bookmarks.find(value => value.uid === uid), `static bookmark ${uid}`);
      const target = requireTarget(bookmarks.find(value => value.uid === targetUid), `static bookmark ${targetUid}`);
      const sourceIndex = bookmarks.indexOf(source);
      const targetIndex = bookmarks.indexOf(target);
      if (source === target || (position === "before" ? sourceIndex + 1 === targetIndex : targetIndex + 1 === sourceIndex)) return;
      bookmarks.splice(sourceIndex, 1);
      bookmarks.splice(bookmarks.indexOf(target) + (position === "after" ? 1 : 0), 0, source);
      publish(["bookmarks"], true);
    },
    setDynamicType(uid: string, type: DynamicBookmark["type"]): void {
      requireTarget(settingsDraft.dynamicBookmarks.find(value => value.uid === uid), `dynamic bookmark ${uid}`).type = type;
      publish(["bookmarks"], true);
    },
    setDynamicRewrite(uid: string, rewrite: string): void {
      requireTarget(settingsDraft.dynamicBookmarks.find(value => value.uid === uid), `dynamic bookmark ${uid}`).rewrite = rewrite;
      publish(["bookmarks"]);
    },
    setDynamicRule(uid: string, ruleUid: string | undefined): void {
      if (ruleUid) ruleUids([ruleUid]);
      setOptional(requireTarget(settingsDraft.dynamicBookmarks.find(value => value.uid === uid), `dynamic bookmark ${uid}`), { urlRuleUid: ruleUid });
      publish(["bookmarks"]);
    },
    removeBookmark(type: CustomBookmarkType, uid: string): void {
      definition(type, uid);
      if (type === "static")
        settingsDraft.staticBookmarks = settingsDraft.staticBookmarks.filter(
          (value) => value.uid !== uid,
        );
      else if (type === "temporary")
        settingsDraft.temporaryBookmarks = settingsDraft.temporaryBookmarks.filter(
          (value) => value.uid !== uid,
        );
      else
        settingsDraft.dynamicBookmarks = settingsDraft.dynamicBookmarks.filter(
          (value) => value.uid !== uid,
        );
      for (const target of settingsDraft.menus)
        target.items = target.items.filter(
          (value) => value.type !== type || customBookmarkUid(value) !== uid,
        );
      for (const target of [...settingsDraft.shortcuts, ...settingsDraft.nativeShortcuts]) {
        if (target.type === type && customBookmarkUid(target) === uid) {
          delete target.type;
          delete target.dynamicUid;
          delete target.staticUid;
          delete target.temporaryUid;
        }
      }
      publish(["bookmarks", "menus", "shortcuts"], true);
    },
    addUrlRule(value: UrlRule): void {
      if (settingsDraft.urlRules.some((rule) => rule.uid === value.uid))
        throw new Error(`Duplicate URL rule ${value.uid}`);
      settingsDraft.urlRules.push(structuredClone(value));
      publish(["rules", "menus"], true);
    },
    renameUrlRule(uid: string, name: string): void {
      requireTarget(
        settingsDraft.urlRules.find((rule) => rule.uid === uid),
        `URL rule ${uid}`,
      ).name = name;
      publish(["rules", "menus"]);
    },
    setUrlPatterns(uid: string, text: string): void {
      requireTarget(
        settingsDraft.urlRules.find((rule) => rule.uid === uid),
        `URL rule ${uid}`,
      ).patterns = text
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      publish(["rules"]);
    },
    setDefaultRule(uid: string | undefined): void {
      if (uid) ruleUids([uid]);
      setOptional(settingsDraft, { defaultUrlRuleUid: uid });
      publish(["rules", "menus"]);
    },
    removeUrlRule(uid: string): void {
      requireTarget(
        settingsDraft.urlRules.find((rule) => rule.uid === uid),
        `URL rule ${uid}`,
      );
      settingsDraft.urlRules = settingsDraft.urlRules.filter((rule) => rule.uid !== uid);
      if (settingsDraft.defaultUrlRuleUid === uid) delete settingsDraft.defaultUrlRuleUid;
      for (const bookmark of settingsDraft.dynamicBookmarks) {
        if (bookmark.urlRuleUid === uid) delete bookmark.urlRuleUid;
      }
      for (const target of settingsDraft.menus) {
        const remaining = target.urlRuleUids?.filter((value) => value !== uid);
        setOptional(target, { urlRuleUids: remaining?.length ? remaining : undefined });
      }
      publish(["rules", "menus", "bookmarks"], true);
    },
    addNativeShortcut(value: StoredNativeShortcut): void {
      if (settingsDraft.nativeShortcuts.some((target) => target.id === value.id))
        throw new Error(`Duplicate shortcut ${value.id}`);
      settingsDraft.nativeShortcuts.push(structuredClone(value));
      publish(["shortcuts"], true);
    },
    setNativeKey(id: string, key: string): void {
      shortcut({ kind: "native", id });
      requireTarget(
        settingsDraft.nativeShortcuts.find((value) => value.id === id),
        `native shortcut ${id}`,
      ).key = key;
      publish(["shortcuts"]);
    },
    setShortcutTabMode(id: ShortcutId, tabMode: TabMode): void {
      shortcut(id).tabMode = tabMode;
      publish(["shortcuts"]);
    },
    removeShortcut(id: ShortcutId): void {
      shortcut(id);
      if (id.kind === "slot")
        settingsDraft.shortcuts = settingsDraft.shortcuts.filter((value) => value.slot !== id.slot);
      else
        settingsDraft.nativeShortcuts = settingsDraft.nativeShortcuts.filter(
          (value) => value.id !== id.id,
        );
      publish(["shortcuts"], true);
    },
    setShortcutTarget(id: ShortcutId, selection: ShortcutTarget): void {
      if ("uid" in selection) definition(selection.type, selection.uid);
      if (id.kind === "slot" && !settingsDraft.shortcuts.some((value) => value.slot === id.slot))
        settingsDraft.shortcuts.push({ slot: id.slot, tabMode: "replace" });
      const target = shortcut(id);
      delete target.type;
      delete target.path;
      delete target.url;
      delete target.title;
      delete target.dynamicUid;
      delete target.staticUid;
      delete target.temporaryUid;
      delete target.browserAction;
      delete target.targetMenuUids;
      delete target.menuUid;
      if (selection.type === "bookmark")
        setOptional(target, {
          type: "bookmark",
          path: selection.path ? [...selection.path] : undefined,
          url: selection.url,
          title: selection.title,
        });
      else if ("uid" in selection) Object.assign(target, customBookmarkReference(selection.type, selection.uid));
      else {
        delete target.tabMode;
        Object.assign(target, structuredClone(selection));
      }
      publish(["shortcuts"], true);
    },
  };
}
export type OptionsState = ReturnType<typeof createOptionsState>;
