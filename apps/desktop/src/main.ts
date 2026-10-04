import { invoke } from "@tauri-apps/api/core";
import { getLanguage } from "@browserail/i18n";
import { initializeBarSettings } from "./pages/bar-settings";
import { initializeSurface } from "./pages/menu";
import { initializeListenerSettings } from "./pages/settings";
import { initializePopupSurface } from "./pages/popup";
import "@browserail/menu-ui/styles.css";
import { initializeTemporaryConfirmation } from "./pages/temporary-confirm";
import "./styles.css";

const root = requiredElement("app");

const query = new URLSearchParams(location.search);

// Keep the Rust-rendered tray/menu and window titles in this webview's language.
void invoke("set_ui_language", { language: getLanguage() }).catch(() => {});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
}, true);

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
}, true);

if (query.get("view") === "host") {
  document.body.replaceChildren();
} else if (query.get("view") === "settings") {
  void initializeListenerSettings(root);
} else if (query.get("view") === "barSettings") {
  initializeBarSettings(root, query);
} else if (query.get("view") === "temporaryConfirm") {
  initializeTemporaryConfirmation(root);
} else if (query.get("surface") === "popup") {
  void initializePopupSurface();
} else {
  void initializeSurface(root, query);
}

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value;
}
