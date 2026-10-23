export { initializeBrowserail, type BrowserailHost, type BrowserWindowCandidate, type ShortcutCommand, type ConfirmationSource } from "./runtime";
export { mountOptionsPage } from "./pages/options/page";
export { createBrowserMenus } from "./features/bar/menus";
export { createMenuSync, type MenuSyncHost } from "./features/sync/index";
export { executeMenuAction } from "./features/actions/execute-menu-action";
export { initDynamicBookmarks } from "./features/dynamic/updater";
