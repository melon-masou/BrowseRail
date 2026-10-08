import { invoke } from "@tauri-apps/api/core";
import { getLanguage } from "@browserail/i18n";
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
  void import("./pages/settings").then(page => page.initializeListenerSettings(root));
} else if (query.get("view") === "barSettings") {
  void import("./pages/bar-settings").then(page => page.initializeBarSettings(root, query));
} else if (query.get("view") === "temporaryConfirm") {
  void import("./pages/temporary-confirm").then(page => page.initializeTemporaryConfirmation(root));
} else if (query.get("surface") === "popup") {
  void import("./pages/popup").then(page => page.initializePopupSurface());
} else {
  void import("./pages/menu").then(page => page.initializeSurface(root, query));
}

function requiredElement(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value;
}
