use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

pub const DEFAULT_LISTENER_PORT: u16 = 17654;
pub const DEFAULT_FONT_FAMILY: &str = "Segoe UI";

/// Desktop-local persisted settings. This is a SEPARATE channel from the
/// extension⇄native wire protocol (see packages/protocol): it is stored on disk
/// by the desktop and flows rust→webview via Tauri commands/events, never over
/// the socket. It is intentionally not part of `packages/protocol`.
///
/// How each field reaches the surface webview (apps/desktop/src/main.ts):
///   listener_port   — native WS listener only; not sent to the webview.
///   display_panels  — native show/hide of all surfaces; not read by the webview.
///   debug_enabled   — native debug logging only.
///   lock_editing    — disables right-click "customize" in the webview
///                     (main.ts `editingLocked`), pushed via a Tauri event.
///   font_family     — webview `--desktop-font-family` CSS var
///                     (main.ts `applyFontFamily`), delivered in SurfaceState.
///   collapsed_menus — per-menu collapsed state; drives native geometry and the
///                     webview's collapsed render (SurfaceState/menu-state `collapsed`).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub listener_port: u16,
    #[serde(default = "display_panels_by_default")]
    pub display_panels: bool,
    #[serde(default)]
    pub debug_enabled: bool,
    #[serde(default)]
    pub lock_editing: bool,
    #[serde(default = "font_family_by_default")]
    pub font_family: String,
    #[serde(default)]
    pub collapsed_menus: Vec<CollapsedMenu>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            listener_port: DEFAULT_LISTENER_PORT,
            display_panels: true,
            debug_enabled: false,
            lock_editing: false,
            font_family: DEFAULT_FONT_FAMILY.into(),
            collapsed_menus: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollapsedMenu {
    pub instance_uid: String,
    pub menu_uid: String,
}

pub fn load(app: &tauri::AppHandle) -> Result<DesktopSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(DesktopSettings::default());
    }

    let content =
        fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let settings = serde_json::from_slice::<DesktopSettings>(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))?;
    validate_listener_port(settings.listener_port)?;
    Ok(settings)
}

pub fn save(app: &tauri::AppHandle, settings: &DesktopSettings) -> Result<(), String> {
    validate_listener_port(settings.listener_port)?;
    let path = settings_path(app)?;
    let parent = path.parent().ok_or("Settings path has no parent")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    let content = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&path, content)
        .map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn display_panels_by_default() -> bool {
    true
}

fn font_family_by_default() -> String {
    DEFAULT_FONT_FAMILY.into()
}

pub fn validate_listener_port(port: u16) -> Result<(), String> {
    if port == 0 {
        Err("Listener port must be between 1 and 65535".into())
    } else {
        Ok(())
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| error.to_string())
}
