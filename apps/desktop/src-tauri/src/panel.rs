use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GWLP_HWNDPARENT, GetWindowLongPtrW, HWND_NOTOPMOST, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SetWindowLongPtrW, SetWindowPos, WS_EX_TOPMOST,
};

use crate::protocol::{BrowserWindowSnapshot, MenuAnchor, MenuPlacement};
use crate::state_machine::{SurfaceState, log_surface_transition};

const POPUP_MIN_WIDTH: f64 = 180.0;
const POPUP_MAX_WIDTH: f64 = 1_600.0;
const POPUP_MIN_HEIGHT: f64 = 48.0;
const POPUP_MAX_HEIGHT: f64 = 900.0;

pub fn set_window_always_on_top(window: &WebviewWindow, always_on_top: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let insert_after = if always_on_top {
        HWND_TOPMOST
    } else {
        HWND_NOTOPMOST
    };

    unsafe {
        SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn set_window_owner(window: &WebviewWindow, owner_hwnd: isize) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner_hwnd);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        .map_err(|error| error.to_string())
    }
}

pub fn clear_window_owner(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())
    }
}

pub fn safely_destroy_window(window: &WebviewWindow) -> Result<(), String> {
    let _ = set_window_visible_without_activation(window, false);
    let _ = clear_window_owner(window);
    window.destroy().map_err(|error| error.to_string())
}

pub fn set_window_visible_without_activation(
    window: &WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let visibility = if visible {
        SWP_SHOWWINDOW
    } else {
        SWP_HIDEWINDOW
    };
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | visibility,
        )
        .map_err(|error| error.to_string())
    }
}

fn is_window_always_on_top(window: &WebviewWindow) -> Result<bool, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let extended_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    Ok(extended_style & WS_EX_TOPMOST.0 as isize != 0)
}

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

    pub fn remove_instance(&self, instance_uid: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, popup| popup.surface.instance_uid != instance_uid);
        }
    }

    pub fn remove_window(&self, instance_uid: &str, window_uid: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|_, popup| {
                popup.surface.instance_uid != instance_uid || popup.surface.window_uid != window_uid
            });
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

    pub fn remove_labels(&self, labels: &[String]) {
        if let Ok(mut states) = self.states.lock() {
            states.retain(|label, _| !labels.contains(label));
        }
        if let Ok(mut geometries) = self.geometries.lock() {
            geometries.retain(|label, _| !labels.contains(label));
        }
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

    pub fn visible_labels(&self) -> Vec<String> {
        self.states
            .lock()
            .map(|states| {
                states
                    .iter()
                    .filter(|(_, state)| {
                        matches!(state, SurfaceState::Visible | SurfaceState::Customizing)
                    })
                    .map(|(label, _)| label.clone())
                    .collect()
            })
            .unwrap_or_default()
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
    let (window, is_new) = match app.get_webview_window(&label) {
        Some(window) => (window, false),
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
                .focused(false)
                .focusable(false)
                .resizable(false)
                .shadow(false)
                .skip_taskbar(true)
                .transparent(true)
                .visible(false)
                .build()
                .map(|window| (window, true))
                .map_err(|error| error.to_string())?
        }
    };

    place_popup(&parent, &window, &popup.anchor, popup.width, popup.height)?;
    if is_new {
        let parent_hwnd = parent.hwnd().map_err(|error| error.to_string())?;
        set_window_owner(&window, parent_hwnd.0 as isize)?;
    }
    let is_always_on_top = is_window_always_on_top(&parent).unwrap_or(true);
    let _ = set_window_always_on_top(&window, is_always_on_top);
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    set_window_visible_without_activation(&window, true)?;
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
    _anchor: &PopupAnchor,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let menu_window = app
        .get_webview_window(&menu_label(instance_uid, window_uid, menu_uid))
        .ok_or("Menu window is unavailable")?;
    menu_window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
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
        let _ = set_window_visible_without_activation(&window, false);
        surfaces.mark_hidden(&label);
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

pub(crate) fn instance_surface_prefix(kind: &str, instance_uid: &str) -> String {
    format!("{}-{}-", kind, safe_label_part(instance_uid))
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
