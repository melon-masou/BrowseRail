use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

pub const DEFAULT_LISTENER_PORT: u16 = 17654;

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
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            listener_port: DEFAULT_LISTENER_PORT,
            display_panels: true,
            debug_enabled: false,
            lock_editing: false,
        }
    }
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
