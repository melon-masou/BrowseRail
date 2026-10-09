import type { ExportedSettingsData } from "@browserail/protocol";

export const transferGroups = ["menus", "urlRules", "bookmarks", "shortcuts", "bars"] as const;
export type TransferGroup = typeof transferGroups[number];
export type TransferSelection = Record<TransferGroup, boolean>;
export interface TransferOptions extends TransferSelection { includeRewrites: boolean }

const fields = {
  menus: ["menus", "globalCss"],
  urlRules: ["urlRules", "defaultUrlRuleUid"],
  bookmarks: ["staticBookmarks", "dynamicBookmarks", "temporaryBookmarks", "externalActions", "userVariables"],
  shortcuts: ["shortcuts", "nativeShortcuts"],
  bars: ["barConfigurations"],
} as const;

export function hasTransferGroup(data: ExportedSettingsData, group: TransferGroup): boolean {
  return fields[group].some(field => data[field] !== undefined);
}

export function transferCounts(data: ExportedSettingsData): Record<TransferGroup, number> {
  return {
    menus: data.menus?.length ?? 0,
    urlRules: data.urlRules?.length ?? 0,
    bookmarks: (data.staticBookmarks?.length ?? 0) + (data.dynamicBookmarks?.length ?? 0) + (data.temporaryBookmarks?.length ?? 0) + (data.externalActions?.length ?? 0),
    shortcuts: (data.shortcuts?.length ?? 0) + (data.nativeShortcuts?.length ?? 0),
    bars: Object.keys(data.barConfigurations?.native ?? {}).length + Object.keys(data.barConfigurations?.browser ?? {}).length,
  };
}

export function selectTransferData(data: ExportedSettingsData, selection: Partial<TransferSelection>): ExportedSettingsData {
  const selected = structuredClone(data);
  for (const group of transferGroups) {
    if (selection[group] === false) for (const field of fields[group]) delete selected[field];
  }
  return selected;
}

export function mergeByKey<T>(local: readonly T[], incoming: readonly T[], key: (item: T) => string): T[] {
  const merged = new Map(incoming.map(item => [key(item), item]));
  for (const item of local) if (!merged.has(key(item))) merged.set(key(item), item);
  return [...merged.values()];
}
