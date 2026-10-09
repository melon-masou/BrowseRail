import browser from "webextension-polyfill";
import { t } from "@browserail/i18n";
import type { ExtensionConnectionState } from "../desktop/state-machine";

/** The toolbar icon's badge and tooltip, reflecting whether BrowseRail is on and the desktop connection. */
export function createToolbarBadge() {
  let widgetActive = true;
  return {
    setActive(active: boolean): void { widgetActive = active; },
    update(state: ExtensionConnectionState, detail?: string): void {
      const disabled = !widgetActive;
      // Clicking the toolbar icon toggles enable/disable, so the tooltip states the
      // current state and what a click will do. When disabled, the corner badge
      // shows two blue bars with a transparent background.
      let title = disabled ? t("action.iconTitleDisabled") : t("action.iconTitleEnabled");
      switch (state) {
        case "connected":
          title = `${t("action.iconTitleEnabled")} — Connected (${detail ?? "Ready"})`;
          break;
        case "syncing":
          title = `${t("action.iconTitleEnabled")} — Syncing`;
          break;
        case "connecting":
        case "handshaking":
          title = `${t("action.iconTitleEnabled")} — Connecting…`;
          break;
        case "reconnecting":
          title = `${t("action.iconTitleEnabled")} — Reconnecting (${detail ?? ""})`;
          break;
        case "disconnected":
          title = `${t("action.iconTitleEnabled")} — Disconnected`;
          break;
        case "disabled":
          title = disabled ? t("action.iconTitleDisabled") : t("action.iconTitleEnabled");
          break;
      }
      void browser.action.setBadgeText({ text: disabled ? "OFF" : "" });
      if (disabled) {
        // Transparent background so only the two blue bars show, at the corner.
        void browser.action.setBadgeTextColor?.({ color: "#2563eb" });
        void browser.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
      }
      void browser.action.setTitle({ title });
    },
  };
}
