use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::protocol::{
    BrowserWindowSnapshot, BrowserWindowState, MenuAnchor, MenuPlacement, MenuSnapshot,
    PanelSnapshot,
};
use crate::state_machine::{log_surface_transition, SurfaceState};

const POPUP_MIN_WIDTH: f64 = 180.0;
const POPUP_MAX_WIDTH: f64 = 1_600.0;
const POPUP_MIN_HEIGHT: f64 = 48.0;
const POPUP_MAX_HEIGHT: f64 = 900.0;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupRequest {
    pub anchor: PopupAnchor,
    pub height: f64,
    pub instance_uid: String,
    pub menu_uid: String,
    pub payload: Value,
    pub width: f64,
    pub window_uid: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PopupAnchor {
    pub height: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupSurface {
    pub instance_uid: String,
    pub menu_uid: String,
    pub payload: Value,
    pub window_uid: String,
}

#[derive(Clone)]
struct StoredPopup {
    anchor: PopupAnchor,
    close_generation: u64,
    height: f64,
    surface: PopupSurface,
    width: f64,
}

#[derive(Default)]
pub struct PopupRegistry {
    entries: Mutex<HashMap<String, StoredPopup>>,
}

impl PopupRegistry {
    pub fn surface(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
    ) -> Option<PopupSurface> {
        self.entries
            .lock()
            .ok()?
            .get(&popup_label(instance_uid, window_uid, menu_uid))
            .map(|popup| popup.surface.clone())
    }

    fn set(&self, request: PopupRequest) -> Result<StoredPopup, String> {
        let label = popup_label(
            &request.instance_uid,
            &request.window_uid,
            &request.menu_uid,
        );
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        let close_generation = entries
            .get(&label)
            .map(|popup| popup.close_generation.wrapping_add(1))
            .unwrap_or_default();
        let popup = StoredPopup {
            anchor: request.anchor,
            close_generation,
            height: request.height.clamp(POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT),
            surface: PopupSurface {
                instance_uid: request.instance_uid,
                menu_uid: request.menu_uid,
                payload: request.payload,
                window_uid: request.window_uid,
            },
            width: request.width.clamp(POPUP_MIN_WIDTH, POPUP_MAX_WIDTH),
        };
        entries.insert(label, popup.clone());
        Ok(popup)
    }

    pub fn resize(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
        width: f64,
        height: f64,
    ) -> Result<(PopupAnchor, f64, f64), String> {
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        let popup = entries
            .get_mut(&popup_label(instance_uid, window_uid, menu_uid))
            .ok_or("Popup is unavailable")?;
        popup.width = width.clamp(POPUP_MIN_WIDTH, POPUP_MAX_WIDTH);
        popup.height = height.clamp(POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT);
        Ok((popup.anchor.clone(), popup.width, popup.height))
    }

    pub fn cancel_close(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
    ) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        if let Some(popup) = entries.get_mut(&popup_label(instance_uid, window_uid, menu_uid)) {
            popup.close_generation = popup.close_generation.wrapping_add(1);
        }
        Ok(())
    }

    pub fn schedule_close(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
    ) -> Result<u64, String> {
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        let popup = entries
            .get_mut(&popup_label(instance_uid, window_uid, menu_uid))
            .ok_or("Popup is unavailable")?;
        popup.close_generation = popup.close_generation.wrapping_add(1);
        Ok(popup.close_generation)
    }

    pub fn remove_if_generation(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
        generation: u64,
    ) -> bool {
        let Ok(mut entries) = self.entries.lock() else {
            return false;
        };
        let label = popup_label(instance_uid, window_uid, menu_uid);
        if entries
            .get(&label)
            .is_some_and(|popup| popup.close_generation == generation)
        {
            entries.remove(&label);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, instance_uid: &str, window_uid: &str, menu_uid: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(&popup_label(instance_uid, window_uid, menu_uid));
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
struct AppliedGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    always_on_top: bool,
}

#[derive(Default)]
pub struct SurfaceRegistry {
    states: Mutex<HashMap<String, SurfaceState>>,
    geometries: Mutex<HashMap<String, AppliedGeometry>>,
}

impl SurfaceRegistry {
    pub fn update_geometry(
        &self,
        label: &str,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        always_on_top: bool,
    ) -> bool {
        let new_geo = AppliedGeometry {
            x,
            y,
            width,
            height,
            always_on_top,
        };
        if let Ok(mut geos) = self.geometries.lock() {
            if geos.get(label) == Some(&new_geo) {
                return false;
            }
            geos.insert(label.to_string(), new_geo);
            true
        } else {
            true
        }
    }

    pub fn state(&self, label: &str) -> SurfaceState {
        self.states
            .lock()
            .ok()
            .and_then(|map| map.get(label).copied())
            .unwrap_or(SurfaceState::Created)
    }

    pub fn set_state(&self, label: &str, next: SurfaceState, detail: Option<&str>) {
        if let Ok(mut states) = self.states.lock() {
            let prev = states.get(label).copied().unwrap_or(SurfaceState::Created);
            if prev != next {
                log_surface_transition(label, prev, next, detail);
                states.insert(label.to_string(), next);
            }
        }
    }

    pub fn is_customizing(&self, label: &str) -> bool {
        self.state(label) == SurfaceState::Customizing
    }

    pub fn set_customizing(&self, label: &str, customizing: bool) {
        let next = if customizing {
            SurfaceState::Customizing
        } else {
            SurfaceState::Visible
        };
        self.set_state(
            label,
            next,
            Some(if customizing {
                "Enter customize mode"
            } else {
                "Exit customize mode"
            }),
        );
    }

    pub fn is_visible(&self, label: &str) -> bool {
        matches!(
            self.state(label),
            SurfaceState::Visible | SurfaceState::Customizing
        )
    }

    pub fn mark_visible(&self, label: &str) {
        self.set_state(label, SurfaceState::Visible, None);
    }

    pub fn mark_hidden(&self, label: &str) {
        self.set_state(label, SurfaceState::Hidden, None);
    }

    pub fn summary(&self) -> (usize, usize, usize) {
        if let Ok(states) = self.states.lock() {
            let mut visible = 0;
            let mut customizing = 0;
            let mut hidden = 0;
            for state in states.values() {
                match state {
                    SurfaceState::Visible => visible += 1,
                    SurfaceState::Customizing => customizing += 1,
                    SurfaceState::Hidden | SurfaceState::Created => hidden += 1,
                }
            }
            (visible, customizing, hidden)
        } else {
            (0, 0, 0)
        }
    }
}

pub fn sync_panels(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    panels: &[PanelSnapshot],
    removed_window_uids: &[String],
) -> Result<(), String> {
    for window_uid in removed_window_uids {
        close_panel(app, surfaces, popups, instance_uid, window_uid);
    }
    for panel in panels {
        sync_panel(app, surfaces, popups, instance_uid, panel)?;
    }
    Ok(())
}

pub fn hide_panels(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    window_uids: &[String],
) {
    for window_uid in window_uids {
        hide_panel(app, surfaces, popups, instance_uid, window_uid);
    }
}

pub fn emit_action_result(
    app: &tauri::AppHandle,
    instance_uid: &str,
    window_uid: &str,
    payload: &crate::protocol::ActionResultPayload,
) {
    let menu_prefix = surface_prefix("menu", instance_uid, window_uid);
    let popup_prefix = surface_prefix("popup", instance_uid, window_uid);
    for (label, window) in app.webview_windows() {
        if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
            let _ = window.emit_to(&label, "action-result", payload);
        }
    }
}

pub fn open_popup(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    request: PopupRequest,
) -> Result<(), String> {
    let popup = popups.set(request)?;
    let instance_uid = &popup.surface.instance_uid;
    let window_uid = &popup.surface.window_uid;
    let menu_uid = &popup.surface.menu_uid;
    let label = popup_label(instance_uid, window_uid, menu_uid);
    let parent = app
        .get_webview_window(&menu_label(instance_uid, window_uid, menu_uid))
        .ok_or("Menu window is unavailable")?;
    let window = match app.get_webview_window(&label) {
        Some(window) => window,
        None => {
            let url = format!(
                "index.html?surface=popup&instanceUid={}&windowUid={}&menuUid={}",
                urlencoding::encode(instance_uid),
                urlencoding::encode(window_uid),
                urlencoding::encode(menu_uid),
            );
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
                .title("BrowseRail menu")
                .inner_size(popup.width, popup.height)
                .decorations(false)
                .focusable(false)
                .resizable(false)
                .shadow(false)
                .skip_taskbar(true)
                .transparent(true)
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?
        }
    };

    place_popup(&parent, &window, &popup.anchor, popup.width, popup.height)?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    surfaces.mark_visible(&label);
    window
        .emit_to(&label, "popup-state", &popup.surface.payload)
        .map_err(|error| error.to_string())
}

pub fn resize_popup(
    app: &tauri::AppHandle,
    instance_uid: &str,
    window_uid: &str,
    menu_uid: &str,
    anchor: &PopupAnchor,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parent = app
        .get_webview_window(&menu_label(instance_uid, window_uid, menu_uid))
        .ok_or("Menu window is unavailable")?;
    let window = app
        .get_webview_window(&popup_label(instance_uid, window_uid, menu_uid))
        .ok_or("Popup window is unavailable")?;
    place_popup(&parent, &window, anchor, width, height)
}

pub fn close_popup(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    window_uid: &str,
    menu_uid: &str,
) {
    popups.remove(instance_uid, window_uid, menu_uid);
    let label = popup_label(instance_uid, window_uid, menu_uid);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
        surfaces.mark_hidden(&label);
    }
}

pub fn sync_menu(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    instance_uid: &str,
    panel: &PanelSnapshot,
    menu: &MenuSnapshot,
) -> Result<(), String> {
    let label = menu_label(instance_uid, &panel.window.uid, &menu.uid);
    let placement = &menu.placement;
    let window = match app.get_webview_window(&label) {
        Some(window) => window,
        None => {
            let url = format!(
                "index.html?surface=menu&instanceUid={}&windowUid={}&menuUid={}",
                urlencoding::encode(instance_uid),
                urlencoding::encode(&panel.window.uid),
                urlencoding::encode(&menu.uid),
            );
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
                .title("BrowseRail")
                .inner_size(placement.width, placement.height)
                .decorations(false)
                .focusable(false)
                .resizable(false)
                .shadow(false)
                .skip_taskbar(true)
                .transparent(true)
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?
        }
    };

    let target_pos = menu_position(&panel.window, placement);
    let is_customizing = surfaces.is_customizing(&label);
    let changed = surfaces.update_geometry(
        &label,
        target_pos.x,
        target_pos.y,
        placement.width,
        placement.height,
        panel.always_on_top,
    );

    if changed {
        window
            .set_always_on_top(panel.always_on_top)
            .map_err(|error| error.to_string())?;
        window
            .set_ignore_cursor_events(false)
            .map_err(|error| error.to_string())?;
        if !is_customizing {
            window
                .set_size(LogicalSize::new(placement.width, placement.height))
                .map_err(|error| error.to_string())?;
            window
                .set_position(target_pos)
                .map_err(|error| error.to_string())?;
        }
    }

    let is_visible = surfaces.is_visible(&label);
    if panel.window.state == BrowserWindowState::Minimized {
        if is_visible {
            window.hide().map_err(|error| error.to_string())?;
            surfaces.mark_hidden(&label);
        }
    } else if !is_visible {
        window.show().map_err(|error| error.to_string())?;
        surfaces.mark_visible(&label);
    }
    window
        .emit_to(&label, "menu-state", menu)
        .map_err(|error| error.to_string())
}

fn sync_panel(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    panel: &PanelSnapshot,
) -> Result<(), String> {
    let desired = panel
        .menus
        .iter()
        .map(|menu| menu_label(instance_uid, &panel.window.uid, &menu.uid))
        .collect::<HashSet<_>>();
    let prefix = surface_prefix("menu", instance_uid, &panel.window.uid);
    for (label, window) in app.webview_windows() {
        if label.starts_with(&prefix) && !desired.contains(&label) {
            let _ = window.hide();
            surfaces.mark_hidden(&label);
        }
    }
    for menu in &panel.menus {
        sync_menu(app, surfaces, instance_uid, panel, menu)?;
    }

    let popup_prefix = surface_prefix("popup", instance_uid, &panel.window.uid);
    let active_menu_uids = panel
        .menus
        .iter()
        .map(|menu| safe_label_part(&menu.uid))
        .collect::<HashSet<_>>();
    for (label, window) in app.webview_windows() {
        if let Some(menu_part) = label.strip_prefix(&popup_prefix)
            && !active_menu_uids.contains(menu_part)
        {
            let _ = window.hide();
            surfaces.mark_hidden(&label);
        }
    }
    if let Ok(mut entries) = popups.entries.lock() {
        entries.retain(|label, _| {
            label
                .strip_prefix(&popup_prefix)
                .is_none_or(|menu_part| active_menu_uids.contains(menu_part))
        });
    }
    Ok(())
}

fn close_panel(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    window_uid: &str,
) {
    let menu_prefix = surface_prefix("menu", instance_uid, window_uid);
    let popup_prefix = surface_prefix("popup", instance_uid, window_uid);
    for (label, window) in app.webview_windows() {
        if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
            let _ = window.hide();
            surfaces.mark_hidden(&label);
        }
    }
    if let Ok(mut entries) = popups.entries.lock() {
        entries.retain(|label, _| !label.starts_with(&popup_prefix));
    }
}

fn hide_panel(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    window_uid: &str,
) {
    let menu_prefix = surface_prefix("menu", instance_uid, window_uid);
    let popup_prefix = surface_prefix("popup", instance_uid, window_uid);
    for (label, window) in app.webview_windows() {
        if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
            let _ = window.hide();
            surfaces.mark_hidden(&label);
        }
    }
    if let Ok(mut entries) = popups.entries.lock() {
        entries.retain(|label, _| !label.starts_with(&popup_prefix));
    }
}

fn place_popup(
    parent: &WebviewWindow,
    popup: &WebviewWindow,
    anchor: &PopupAnchor,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let scale = parent.scale_factor().map_err(|error| error.to_string())?;
    let parent_position = parent.outer_position().map_err(|error| error.to_string())?;
    let parent_x = f64::from(parent_position.x) / scale;
    let parent_y = f64::from(parent_position.y) / scale;
    let mut x = parent_x + anchor.x;
    let mut y = parent_y + anchor.y + anchor.height;
    let mut visible_width = width;
    let mut visible_height = height;

    if let Some(monitor) = parent
        .current_monitor()
        .map_err(|error| error.to_string())?
    {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let left = f64::from(monitor_position.x) / scale;
        let top = f64::from(monitor_position.y) / scale;
        let right = left + f64::from(monitor_size.width) / scale;
        let bottom = top + f64::from(monitor_size.height) / scale;
        visible_width = visible_width.min(right - left);
        visible_height = visible_height.min(bottom - top);
        if y + visible_height > bottom {
            y = parent_y + anchor.y - visible_height;
        }
        x = x.clamp(left, (right - visible_width).max(left));
        y = y.clamp(top, (bottom - visible_height).max(top));
    }

    popup
        .set_size(LogicalSize::new(visible_width, visible_height))
        .map_err(|error| error.to_string())?;
    popup
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

pub fn menu_position(
    window: &BrowserWindowSnapshot,
    placement: &MenuPlacement,
) -> LogicalPosition<f64> {
    let bounds = &window.bounds;
    let x = match placement.anchor {
        MenuAnchor::TopLeft | MenuAnchor::BottomLeft => bounds.x + placement.offset_x,
        MenuAnchor::TopRight | MenuAnchor::BottomRight => {
            bounds.x + bounds.width - placement.width - placement.offset_x
        }
    };
    let y = match placement.anchor {
        MenuAnchor::TopLeft | MenuAnchor::TopRight => bounds.y + placement.offset_y,
        MenuAnchor::BottomLeft | MenuAnchor::BottomRight => {
            bounds.y + bounds.height - placement.height - placement.offset_y
        }
    };
    LogicalPosition::new(x, y)
}

pub fn menu_label(instance_uid: &str, window_uid: &str, menu_uid: &str) -> String {
    format!(
        "menu-{}-{}-{}",
        safe_label_part(instance_uid),
        safe_label_part(window_uid),
        safe_label_part(menu_uid)
    )
}

pub(crate) fn popup_label(instance_uid: &str, window_uid: &str, menu_uid: &str) -> String {
    format!(
        "popup-{}-{}-{}",
        safe_label_part(instance_uid),
        safe_label_part(window_uid),
        safe_label_part(menu_uid)
    )
}

pub(crate) fn surface_prefix(kind: &str, instance_uid: &str, window_uid: &str) -> String {
    format!(
        "{}-{}-{}-",
        kind,
        safe_label_part(instance_uid),
        safe_label_part(window_uid)
    )
}

fn safe_label_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}
