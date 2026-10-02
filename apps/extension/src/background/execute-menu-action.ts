import browser from "webextension-polyfill";
import { isDynamicAction, parseDynamicAction, parseTemporaryAction } from "@browserail/protocol";
import { loadConfig, saveConfig, loadDynamicValues, loadTemporaryValues } from "../config";
import { navigateBookmark, navigateToUrl } from "../tab-actions/navigate";
import { captureTemporaryUrl } from "./temporary";
import { runTabAction, toggleTargetMenus } from "./menu-actions";

export async function executeMenuAction(actionUid: string, menuUid: string | undefined, targetWindowUid: string, changed: () => void): Promise<void> {
  if (actionUid.startsWith("noop")) return;
  if (actionUid.startsWith("browserAction:") || actionUid.startsWith("menusToggle:")) {
    const separator = actionUid.indexOf(":");
    const type = actionUid.slice(0, separator);
    const uid = decodeURIComponent(actionUid.slice(separator + 1));
    const config = await loadConfig();
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
  } else if (isDynamicAction(actionUid)) {
    const { dynamicUid, tabMode } = parseDynamicAction(actionUid);
    const live = (await loadDynamicValues())[dynamicUid];
    if (live?.url) {
      await navigateToUrl(browser, targetWindowUid, live.url, tabMode);
    }
  } else if (actionUid.startsWith("temporarySave:")) {
    const raw = actionUid.slice("temporarySave:".length);
    const queryIndex = raw.indexOf("?");
    const uid = decodeURIComponent(queryIndex < 0 ? raw : raw.slice(0, queryIndex));
    const params = new URLSearchParams(queryIndex < 0 ? "" : raw.slice(queryIndex + 1));
    const config = await loadConfig();
    const tree = await browser.bookmarks.getTree();
    const result = await captureTemporaryUrl(
      browser.tabs,
      config.panel.menus,
      uid,
      targetWindowUid,
      params.get("confirmed") === "1",
      params.get("note") ?? "",
      tree,
    );
    if (result === "saved") changed();
  } else if (actionUid.startsWith("temporary:")) {
    const { uid, tabMode } = parseTemporaryAction(actionUid);
    const url = (await loadTemporaryValues())[uid];
    if (url) await navigateToUrl(browser, targetWindowUid, url, tabMode);
  } else {
    await navigateBookmark(browser, targetWindowUid, actionUid);
  }
}
