import browser from "webextension-polyfill";
import { onLanguageChange, t } from "@browserail/i18n";
import type { DisplayMode, UrlRule } from "../config";
import { ALL_WEBSITE_ORIGINS, incompleteRuleUids, loadWebsiteOrigins, revokeWebsitePermissions, ruleSites, type RuleSites } from "../site-permissions";

export function createSiteAuthorization(options: {
  root: HTMLElement;
  warning: HTMLElement;
  getMode(): DisplayMode;
  getRules(): UrlRule[];
  hasUnsavedRules(): boolean;
}) {
  const authorize = document.createElement("button"); authorize.type = "button"; authorize.className = "action-btn";
  const revoke = document.createElement("button"); revoke.type = "button"; revoke.className = "action-btn";
  const warning = options.warning;
  const status = document.createElement("output"); status.setAttribute("aria-live", "polite");
  options.root.append(authorize, revoke, status);
  const dialog = document.createElement("dialog"); dialog.className = "space-bookmark-dialog site-authorization-dialog";
  document.body.append(dialog);
  let revision = 0;
  let busy = false;
  let dialogOrigins: string[] | undefined;
  let savedRules: RuleSites[] = [];
  let checked = false;
  let hasOrigins = false;
  let incomplete = new Set<string>();
  const report = (error: unknown): void => { status.textContent = `${t("siteAuthorization.failed")}: ${String(error)}`; };

  function render(): void {
    const active = options.getMode() === "browser";
    options.root.hidden = !active;
    authorize.textContent = t("siteAuthorization.authorize"); revoke.textContent = t("siteAuthorization.revoke");
    warning.textContent = t("siteAuthorization.incomplete");
    warning.hidden = !active || !checked || (hasOrigins && incomplete.size === 0);
    authorize.disabled = busy; revoke.disabled = busy || !hasOrigins;
    for (const node of document.querySelectorAll<HTMLElement>("[data-rule-permission]")) {
      node.textContent = t("siteAuthorization.incomplete"); node.hidden = !active || !incomplete.has(node.dataset.rulePermission!);
    }
    if (!active && dialog.open && !busy) dialog.close();
  }
  async function refresh(): Promise<void> {
    const current = ++revision;
    render();
    if (options.getMode() !== "browser") return;
    const [origins, missing] = await Promise.all([loadWebsiteOrigins(), incompleteRuleUids(savedRules)]);
    if (current !== revision) return;
    hasOrigins = origins.length > 0; incomplete = missing; checked = true;
    render();
  }
  function refreshSafely(): void { void refresh().catch(report); }
  function text<K extends keyof HTMLElementTagNameMap>(tag: K, content: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); node.textContent = content; return node;
  }
  function list(parent: HTMLElement, values: string[]): void {
    const ul = document.createElement("ul");
    for (const value of values) ul.append(text("li", value));
    if (!values.length) ul.append(text("li", t("siteAuthorization.none")));
    parent.append(ul);
  }
  async function open(): Promise<void> {
    if (options.getMode() !== "browser" || busy) return;
    const snapshot = options.getRules().map(ruleSites);
    const unsaved = options.hasUnsavedRules();
    const [origins, allGranted] = await Promise.all([loadWebsiteOrigins(), browser.permissions.contains({ origins: ALL_WEBSITE_ORIGINS })]);
    if (options.getMode() !== "browser" || dialog.open) return;
    dialogOrigins = origins;
    status.textContent = "";
    dialog.replaceChildren();
    const heading = document.createElement("div"); heading.className = "space-bookmark-dialog-header";
    heading.append(text("span", t("siteAuthorization.authorize")));
    const close = text("button", "×"); close.type = "button"; close.className = "dialog-close-btn"; close.setAttribute("aria-label", t("customize.cancel"));
    close.addEventListener("click", () => dialog.close()); heading.append(close);
    const body = document.createElement("div"); body.className = "space-bookmark-dialog-body";
    body.append(text("strong", t("siteAuthorization.current")));
    const currentSites = document.createElement("div"); list(currentSites, origins); body.append(currentSites);
    if (unsaved) { const hint = text("p", t("siteAuthorization.unsaved")); hint.className = "space-bookmark-help"; body.append(hint); }
    const controls = document.createElement("div"); controls.className = "site-authorization-choices";
    const all = document.createElement("input"); all.type = "radio"; all.name = "site-authorization-scope"; all.value = "all"; all.checked = allGranted;
    const selected = document.createElement("input"); selected.type = "radio"; selected.name = all.name; selected.value = "rules"; selected.checked = !allGranted;
    const allLabel = document.createElement("label"); allLabel.append(all, text("span", t("siteAuthorization.all")));
    const selectedLabel = document.createElement("label"); selectedLabel.append(selected, text("span", t("siteAuthorization.rules")));
    controls.append(allLabel, selectedLabel); body.append(controls);
    const ruleList = document.createElement("div"); ruleList.className = "site-authorization-rule-list";
    const checks: { input: HTMLInputElement; rule: RuleSites }[] = [];
    for (const rule of snapshot) {
      const label = document.createElement("label");
      const input = document.createElement("input"); input.type = "checkbox"; input.checked = rule.origins.length > 0; input.disabled = !rule.origins.length;
      label.append(input, text("span", rule.name || t("urlRules.defaultName"))); ruleList.append(label);
      checks.push({ input, rule });
    }
    body.append(ruleList, text("strong", t("siteAuthorization.requested")));
    const requested = document.createElement("div"); body.append(requested);
    const unsupported = snapshot.flatMap(rule => rule.unsupported.map(item => `${rule.name || t("urlRules.defaultName")}: ${item.pattern} — ${t(`siteAuthorization.reason.${item.reason}`)}`));
    if (unsupported.length) { body.append(text("strong", t("siteAuthorization.unsupported"))); list(body, unsupported); }
    const message = document.createElement("output"); message.setAttribute("aria-live", "polite"); body.append(message);
    const actions = document.createElement("div"); actions.className = "space-bookmark-dialog-actions";
    const confirm = text("button", t("siteAuthorization.confirm")); confirm.type = "button"; confirm.className = "save-btn";
    const cancel = text("button", t("customize.cancel")); cancel.type = "button"; cancel.className = "action-btn"; cancel.addEventListener("click", () => dialog.close());
    actions.append(confirm, cancel); body.append(actions);
    const targets = (): string[] => all.checked ? [...ALL_WEBSITE_ORIGINS] : [...new Set(checks.filter(item => item.input.checked).flatMap(item => item.rule.origins))];
    let prepared: string[] | undefined;
    const renderScope = (): void => {
      ruleList.hidden = all.checked;
      all.disabled = selected.disabled = busy || prepared !== undefined;
      for (const { input, rule } of checks) input.disabled = busy || prepared !== undefined || !rule.origins.length;
      requested.replaceChildren(); list(requested, prepared ?? targets()); confirm.disabled = busy || !(prepared ?? targets()).length;
    };
    controls.addEventListener("change", renderScope); ruleList.addEventListener("change", renderScope); renderScope();
    confirm.addEventListener("click", () => {
      if (busy || options.getMode() !== "browser") return;
      const chosen = prepared ?? targets();
      if (!chosen.length) return;
      busy = true; confirm.disabled = cancel.disabled = close.disabled = true; authorize.disabled = revoke.disabled = true;
      const request = () => browser.permissions.request({ origins: chosen }).then(granted => {
        if (granted) dialog.close(); else message.textContent = t("siteAuthorization.denied");
      });
      // Firefox requires a new click after awaiting revocation; Chrome keeps
      // the user gesture and can finish the replacement from this click.
      const replacing = origins.length > 0 && prepared === undefined;
      const operation = replacing ? revokeWebsitePermissions().then(() => {
        prepared = chosen;
        dialogOrigins = [];
        confirm.textContent = t("siteAuthorization.grant");
        currentSites.replaceChildren(); list(currentSites, []);
        if (typeof __BROWSERAIL_TARGET__ === "undefined" || __BROWSERAIL_TARGET__ !== "firefox") return request();
        message.textContent = t("siteAuthorization.ready");
      }) : request();
      renderScope();
      void operation.catch(error => { message.textContent = `${t("siteAuthorization.failed")}: ${String(error)}`; }).finally(() => {
        busy = false; cancel.disabled = close.disabled = false; renderScope(); refreshSafely();
      });
    });
    dialog.oncancel = event => { if (busy) event.preventDefault(); };
    dialog.append(heading, body); dialog.showModal();
  }
  authorize.addEventListener("click", () => { void open().catch(report); });
  revoke.addEventListener("click", () => {
    if (busy || options.getMode() !== "browser") return;
    busy = true; authorize.disabled = revoke.disabled = true; status.textContent = "";
    void revokeWebsitePermissions().catch(report).finally(() => { busy = false; refreshSafely(); });
  });
  const permissionsChanged = (): void => {
    void loadWebsiteOrigins().then(origins => {
      if (dialog.open && !busy && JSON.stringify([...origins].sort()) !== JSON.stringify([...(dialogOrigins ?? [])].sort())) dialog.close();
    }).catch(report);
    refreshSafely();
  };
  browser.permissions.onAdded.addListener(permissionsChanged);
  browser.permissions.onRemoved.addListener(permissionsChanged);
  onLanguageChange(render);
  return {
    refresh(rules: UrlRule[]): void { savedRules = rules.map(ruleSites); refreshSafely(); },
    render,
  };
}
