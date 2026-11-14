export const EDIT_MENU_ID = "browserail-edit-menus";
export const ADD_STATIC_MENU_ID = "browserail-add-static-bookmark";
export const OPTIONS_MENU_ID = "browserail-open-options";
export const ENABLE_MENU_ID = "browserail-enable";
export const SHORTCUTS_MENU_ID = "browserail-shortcuts";

export const USER_MENU_ITEMS = [
  { id: ENABLE_MENU_ID, title: "action.enabled", type: "checkbox" },
  { id: EDIT_MENU_ID, title: "injection.editMenus", type: "checkbox" },
  { id: SHORTCUTS_MENU_ID, title: "section.shortcuts", type: "checkbox" },
  { id: ADD_STATIC_MENU_ID, title: "static.addCurrentPage", type: "normal" },
  { id: OPTIONS_MENU_ID, title: "action.openOptions", type: "normal" },
] as const;

export type UserMenuId = (typeof USER_MENU_ITEMS)[number]["id"];
