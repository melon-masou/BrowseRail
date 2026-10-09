import { t } from "@browserail/i18n";
import { type ShortcutAction } from "@browserail/protocol";
import { createItemPicker, type PickerItem } from "./item-picker";

export function actionChoices(): PickerItem[] {
  return [
    { id: "back", label: t("menuAction.back") },
    { id: "forward", label: t("menuAction.forward") },
    { id: "reload", label: t("menuAction.reload") },
    { id: "menusToggle", label: t("menuAction.menusToggle") },
    { id: "menuFold", label: t("menu.addMenuFold") },
    { id: "shortcutsToggle", label: t("menuAction.shortcutsToggle") },
  ];
}

export function createShortcutActionPicker() {
  const picker = createItemPicker();
  return {
    async pick(menuOptions: readonly { uid: string; name?: string }[]): Promise<ShortcutAction | null> {
      const kind = await picker.pick(t("menu.action"), actionChoices());
      if (!kind) return null;
      if (kind === "shortcutsToggle") return { type: kind };
      const menus = menuOptions.map((menu, index) => ({ id: menu.uid, label: menu.name ?? t("menu.title", { n: index + 1 }) }));
      if (kind === "menusToggle") {
        const targets = await picker.pickMany(t("menuAction.targets"), menus, t("menuAction.noTargets"));
        return targets === null ? null : { type: kind, targetMenuUids: targets };
      }
      if (kind === "menuFold") {
        const uid = await picker.pick(t("menuAction.targets"), menus, t("menuAction.noTargets"));
        return uid === null ? null : { type: kind, menuUid: uid };
      }
      return { type: "browserAction", browserAction: kind as "back" | "forward" | "reload" };
    },
    destroy(): void { picker.destroy(); },
  };
}

export function shortcutActionLabel(action: { type?: string; browserAction?: string; menuUid?: string; targetMenuUids?: readonly string[] }, menus: readonly { uid: string; name?: string }[]): string {
  const menuName = (uid: string) => {
    const index = menus.findIndex(menu => menu.uid === uid);
    return index < 0 ? t("menuAction.noTargets") : menus[index]!.name ?? t("menu.title", { n: index + 1 });
  };
  if (action.type === "menuFold") return `${t("menu.addMenuFold")} · ${menuName(action.menuUid ?? "")}`;
  if (action.type === "menusToggle") return `${t("menuAction.menusToggle")} · ${(action.targetMenuUids ?? []).map(menuName).join(", ")}`;
  if (action.type === "shortcutsToggle") return t("menuAction.shortcutsToggle");
  const labels = { back: "menuAction.back", forward: "menuAction.forward", reload: "menuAction.reload" } as const;
  return action.browserAction && action.browserAction in labels ? t(labels[action.browserAction as keyof typeof labels]) : "";
}
