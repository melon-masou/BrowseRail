import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import { ALL_URLS_RULE_UID, DEFAULT_EXTERNAL_EVENT_NAME, matchesUrlRule, type ExternalAction, type UrlRule } from "@browserail/protocol";
import { loadExternalAuthorization } from "../../lib/config/external-authorization-store";
import { hasWebsitePermission } from "../../lib/browser/site-permissions";
import { EXTERNAL_RUN_MESSAGE, type ExternalRun } from "@browserail/protocol/content";
import { requestTab } from "../../lib/messaging";

/**
 * Runs an external action against the active tab. Only sending is checked; the extension's reply
 * or the page's handling is ignored. Events go through the userscript receiver, which exists only
 * on authorized sites while userscript API access is enabled.
 */
export async function runExternalAction(action: ExternalAction, urlRules: readonly UrlRule[], windowUid: string): Promise<void> {
  const windowId = Number(windowUid);
  if (!Number.isInteger(windowId)) return;
  const [tab] = await browser.tabs.query({ active: true, windowId });
  if (action.urlRuleUid !== ALL_URLS_RULE_UID) {
    const rule = urlRules.find(value => value.uid === action.urlRuleUid);
    if (!rule || !tab?.url || !matchesUrlRule(tab.url, rule)) throw new Error(t("externalAction.ruleMismatch"));
  }
  if (action.target === "extension") {
    // Saving validates the JSON, so a parse failure here means the stored config was edited by hand.
    await browser.runtime.sendMessage(action.extensionId ?? "", action.data ? JSON.parse(action.data) as unknown : null);
    return;
  }
  const authorization = await loadExternalAuthorization();
  if (!authorization.userscriptEnabled || !authorization.token) throw new Error(t("externalAction.userscriptDisabled"));
  if (tab?.id === undefined || !tab.url || !await hasWebsitePermission(tab.url)) throw new Error(t("externalAction.siteNotAuthorized"));
  const eventName = (action.eventName || DEFAULT_EXTERNAL_EVENT_NAME).split("${token}").join(authorization.token);
  const delivered = await requestTab<ExternalRun>(tab.id, { type: EXTERNAL_RUN_MESSAGE, eventName, detail: action.data ?? null }, { frameId: 0 })
    .catch(() => false);
  // Pages opened before access was granted have no receiver until they reload.
  if (delivered !== true) throw new Error(t("externalAction.reloadPage"));
}
