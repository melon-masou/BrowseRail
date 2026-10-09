import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import {
  customBookmarkUid,
  isCustomBookmarkType,
  type CustomBookmarkType,
} from "@browserail/protocol";
import {
  DYNAMIC_VALUE_STORAGE_PREFIX,
  clearTemporaryValue,
  loadDynamicValues,
  loadTemporaryValues,
  loadTemporaryNotes,
  type DynamicValuesMap,
  type DynamicBookmark,
  type StaticBookmark,
  type TemporaryBookmark,
  type ExternalAction,
  type StoredMenuItem,
  type StoredShortcut,
  type StoredNativeShortcut,
} from "../../config";
import type { OptionsState, ReadonlyData } from "./state";
import { createScope } from "./lifecycle";
export function createCustomBookmarkSource(state: OptionsState) {
  const scope = createScope();
  const listeners = new Set<(type: "temporary" | "dynamic") => void>();
  let temporaryValuesCache: Record<string, string> = {};
  let temporaryNotesCache: Record<string, string> = {};
  let dynamicValuesCache: DynamicValuesMap = {};
  function definitionsFor(
    type: CustomBookmarkType,
  ): ReadonlyData<Array<StaticBookmark | TemporaryBookmark | DynamicBookmark | ExternalAction>> {
    return type === "static"
      ? state.settings.staticBookmarks
      : type === "temporary"
        ? state.settings.temporaryBookmarks
        : type === "externalAction"
          ? state.settings.externalActions
          : state.settings.dynamicBookmarks;
  }

  function customTargetName(
    target: ReadonlyData<StoredMenuItem | StoredShortcut | StoredNativeShortcut>,
  ): string {
    if (!isCustomBookmarkType(target.type)) return "";
    const uid = customBookmarkUid(target);
    return (
      definitionsFor(target.type).find((entry) => entry.uid === uid)?.name ||
      t(`${target.type}.defaultName`)
    );
  }

  function customTargetUrl(type: CustomBookmarkType, uid: string): string | undefined {
    return type === "static"
      ? state.settings.staticBookmarks.find((entry) => entry.uid === uid)?.url
      : type === "temporary"
        ? temporaryValuesCache[uid]
        : type === "dynamic"
          ? dynamicValuesCache[uid]?.url
          : undefined;
  }

  function customTargetIcon(type: CustomBookmarkType): string {
    return type === "temporary" ? "📌" : type === "dynamic" ? "🜂" : type === "externalAction" ? "🔌" : "🔖";
  }

  async function refreshTemporaryValues(): Promise<void> {
    [temporaryValuesCache, temporaryNotesCache] = await Promise.all([
      loadTemporaryValues(),
      loadTemporaryNotes(),
    ]);
    for (const listener of listeners) listener("temporary");
  }

  async function refreshDynamicValues(): Promise<void> {
    try {
      dynamicValuesCache = await loadDynamicValues(state.settings.dynamicBookmarks.map(bookmark => bookmark.uid));
    } catch {
      dynamicValuesCache = {};
    }
    for (const listener of listeners) listener("dynamic");
  }

  const changed = (changes: Record<string, browser.Storage.StorageChange>, area: string): void => {
    if (area !== "local") return;
    if (changes.temporary_bookmark_values || changes.temporary_bookmark_notes)
      void refreshTemporaryValues();
    if (Object.keys(changes).some(key => key.startsWith(DYNAMIC_VALUE_STORAGE_PREFIX)))
      void refreshDynamicValues();
  };
  browser.storage.onChanged.addListener(changed);
  scope.add(() => browser.storage.onChanged.removeListener(changed));
  return {
    definitions: definitionsFor,
    name: customTargetName,
    url: customTargetUrl,
    icon: customTargetIcon,
    refreshTemporary: refreshTemporaryValues,
    async clearTemporary(uid: string): Promise<void> {
      await clearTemporaryValue(uid);
      await refreshTemporaryValues();
    },
    refreshDynamic: refreshDynamicValues,
    get temporaryValues() {
      return temporaryValuesCache;
    },
    get temporaryNotes() {
      return temporaryNotesCache;
    },
    get dynamicValues() {
      return dynamicValuesCache;
    },
    subscribe(listener: (type: "temporary" | "dynamic") => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      scope.destroy();
      listeners.clear();
    },
  };
}
export type CustomBookmarkSource = ReturnType<typeof createCustomBookmarkSource>;
