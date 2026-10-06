import { t } from "@browserail/i18n";
import type { OptionsState } from "../state";
import { element } from "../dom";
import { createScope } from "../lifecycle";

export function mountExternalAuthorization(state: OptionsState) {
  const scope = createScope();
  const extensions = element<HTMLTextAreaElement>("external-extension-ids");
  const extensionsEnabled = element<HTMLInputElement>("external-extensions-enabled");
  const enabled = element<HTMLInputElement>("external-userscript-enabled");
  const token = element<HTMLInputElement>("external-token");
  const copy = element<HTMLButtonElement>("copy-external-token");
  const regenerate = element<HTMLButtonElement>("regenerate-external-token");
  const status = element<HTMLOutputElement>("external-authorization-status");
  const extensionsDialog = element<HTMLDialogElement>("external-extensions-dialog");
  const tokenDialog = element<HTMLDialogElement>("external-token-dialog");

  for (const [buttonId, dialog] of [
    ["configure-external-extensions", extensionsDialog],
    ["configure-external-token", tokenDialog],
  ] as const) {
    element<HTMLButtonElement>(buttonId).addEventListener("click", () => dialog.showModal(), { signal: scope.signal });
    dialog.querySelector<HTMLButtonElement>("[data-external-dialog-close]")!.addEventListener("click", () => dialog.close(), { signal: scope.signal });
    scope.add(() => dialog.close());
  }

  extensionsEnabled.addEventListener("change", () => state.setExternalExtensionsEnabled(extensionsEnabled.checked), { signal: scope.signal });
  extensions.addEventListener("input", () => state.setExternalExtensionIds(extensions.value), { signal: scope.signal });
  enabled.addEventListener("change", () => state.setUserscriptEnabled(enabled.checked), { signal: scope.signal });
  regenerate.addEventListener("click", () => state.regenerateExternalToken(), { signal: scope.signal });
  copy.addEventListener("click", () => {
    status.value = "";
    status.hidden = true;
    void navigator.clipboard.writeText(token.value).catch(error => {
      if (!scope.signal.aborted) {
        status.value = t("externalAuthorization.copyFailed", { error: String(error) });
        status.hidden = false;
      }
    });
  }, { signal: scope.signal });

  function render(): void {
    const authorization = state.instance.externalAuthorization;
    extensions.placeholder = t("externalAuthorization.extensionsPlaceholder");
    const text = authorization.extensionIds.join("\n");
    if (extensions.value !== text) extensions.value = text;
    extensionsEnabled.checked = authorization.extensionsEnabled;
    enabled.checked = authorization.userscriptEnabled;
    token.value = authorization.token;
    copy.disabled = !authorization.token;
  }
  scope.add(state.subscribe(["instance"], render));
  render();
  return { render, destroy: scope.destroy };
}
