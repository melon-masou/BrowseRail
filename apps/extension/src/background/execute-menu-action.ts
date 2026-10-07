import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { actionUid as formatActionUid, isDynamicAction, parseBookmarkAction, parseDynamicAction, parseTemporaryAction, parseStaticAction, type CustomBookmarkType } from "@browserail/protocol";
import { loadConfig, saveConfig, loadDynamicValue, loadTemporaryValues } from "../config";
import { navigateBookmark, navigateToUrl } from "../browser/navigation";
import { captureTemporaryUrl } from "./temporary";
import { runTabAction, toggleTargetMenus } from "./menu-actions";
import { resolveStaticBookmarkUrl } from "../bookmarks/variables";
import { resolveMenuBookmarkTarget } from "../bookmarks/menu-target";

export async function executeMenuAction(actionUid: string, menuUid: string | undefined, targetWindowUid: string, changed: () => void): Promise<void> {
  if (actionUid.startsWith("noop")) return;
  const config = await loadConfig();
  const targetUid = (identity: string, type: "bookmark" | CustomBookmarkType): Promise<string> =>
    menuUid === undefined ? Promise.resolve(identity) : resolveMenuBookmarkTarget(config, menuUid, identity, type);
  if (actionUid.startsWith("browserAction:") || actionUid.startsWith("menusToggle:")) {
    const separator = actionUid.indexOf(":");
    const type = actionUid.slice(0, separator);
    const uid = decodeURIComponent(actionUid.slice(separator + 1));
    const sourceMenu = config.panel.menus.find((menu) => menu.uid === menuUid);
    const action = sourceMenu?.items.find((item) => item.uid === uid && item.type === type);
    if (sourceMenu && action?.type === "menusToggle") {
      const menus = toggleTargetMenus(config.panel.menus, sourceMenu.uid, action.targetMenuUids ?? []);
      if (menus) {
        await saveConfig({ ...config, panel: { menus } });
        changed();
      }
    } else if (action?.type === "browserAction" && action.browserAction) {
      await runTabAction(browser.tabs, targetWindowUid, action.browserAction);
    }
  } else if (actionUid.startsWith("static:")) {
    const { uid, tabMode } = parseStaticAction(actionUid);
    const target = await targetUid(uid, "static");
    const definition = config.staticBookmarks.find(entry => entry.uid === target);
    if (definition?.url) await navigateToUrl(browser, targetWindowUid, await resolveStaticBookmarkUrl(definition.url, config.userVariables), tabMode);
  } else if (isDynamicAction(actionUid)) {
    const { dynamicUid, tabMode } = parseDynamicAction(actionUid);
    const live = await loadDynamicValue(await targetUid(dynamicUid, "dynamic"));
    if (!live?.url) throw new Error(t("customBookmarks.noSavedUrl"));
    await navigateToUrl(browser, targetWindowUid, live.url, tabMode);
  } else if (actionUid.startsWith("temporarySave:")) {
    const raw = actionUid.slice("temporarySave:".length);
    const queryIndex = raw.indexOf("?");
    const uid = decodeURIComponent(queryIndex < 0 ? raw : raw.slice(0, queryIndex));
    const params = new URLSearchParams(queryIndex < 0 ? "" : raw.slice(queryIndex + 1));
    const result = await captureTemporaryUrl(
      browser.tabs,
      config.temporaryBookmarks,
      await targetUid(uid, "temporary"),
      targetWindowUid,
      params.get("confirmed") === "1",
      params.get("note") ?? "",
    );
    if (result === "saved") changed();
  } else if (actionUid.startsWith("temporary:")) {
    const { uid, tabMode } = parseTemporaryAction(actionUid);
    const target = await targetUid(uid, "temporary");
    if (!config.temporaryBookmarks.some(entry => entry.uid === target)) return;
    const url = (await loadTemporaryValues())[target];
    if (!url) throw new Error(t("customBookmarks.noSavedUrl"));
    await navigateToUrl(browser, targetWindowUid, url, tabMode);
  } else {
    const { uid, tabMode } = parseBookmarkAction(actionUid);
    await navigateBookmark(browser, targetWindowUid, formatActionUid("bookmark", await targetUid(uid, "bookmark"), tabMode));
  }
}
