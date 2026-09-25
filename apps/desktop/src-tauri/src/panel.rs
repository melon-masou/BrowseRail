use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, HGDIOBJ, RGN_OR, SetWindowRgn,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, EnumChildWindows, GWL_EXSTYLE, GWLP_HWNDPARENT, GetWindowLongPtrW,
    GetWindowThreadProcessId, HCBT_ACTIVATE, HWND_NOTOPMOST, HWND_TOPMOST, MA_NOACTIVATE,
    SWP_FRAMECHANGED, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SWP_SHOWWINDOW, SetWindowLongPtrW, SetWindowPos, SetWindowsHookExW, WH_CBT, WM_MOUSEACTIVATE,
    WM_NCDESTROY, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};
use windows::core::BOOL;

use crate::protocol::{BrowserWindowSnapshot, MenuAnchor, MenuPlacement};
use crate::state_machine::{SurfaceState, log_surface_transition};

const POPUP_MIN_WIDTH: f64 = 72.0;
const POPUP_MAX_WIDTH: f64 = 16_384.0;
const POPUP_MIN_HEIGHT: f64 = 48.0;
const POPUP_MAX_HEIGHT: f64 = 900.0;
const NO_ACTIVATE_SUBCLASS_ID: usize = 1;
static NO_ACTIVATE_HOOK_THREADS: LazyLock<Mutex<HashSet<u32>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

unsafe extern "system" fn no_activate_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HCBT_ACTIVATE as i32 {
        let hwnd = HWND(wparam.0 as *mut core::ffi::c_void);
        let extended_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        if extended_style & WS_EX_NOACTIVATE.0 as isize != 0 {
            return LRESULT(1);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn ensure_no_activate_hook(hwnd: HWND) -> Result<(), String> {
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, None) };
    let mut hooked_threads = NO_ACTIVATE_HOOK_THREADS
        .lock()
        .map_err(|_| "no-activate hook registry is unavailable".to_string())?;
    if hooked_threads.contains(&thread_id) {
        return Ok(());
    }
    unsafe {
        let _hook = SetWindowsHookExW(WH_CBT, Some(no_activate_hook_proc), None, thread_id)
            .map_err(|error| error.to_string())?;
    }
    hooked_threads.insert(thread_id);
    Ok(())
}

unsafe extern "system" fn no_activate_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    if message == WM_NCDESTROY {
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(no_activate_window_proc), subclass_id);
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

unsafe extern "system" fn install_no_activate_on_child(hwnd: HWND, _lparam: LPARAM) -> BOOL {
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(no_activate_window_proc),
            NO_ACTIVATE_SUBCLASS_ID,
            0,
        );
    }
    BOOL(1)
}

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
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|error| error.to_string())
    }
}

pub fn set_window_no_activate(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let extended_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            extended_style | WS_EX_NOACTIVATE.0 as isize,
        );
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|error| error.to_string())?;
        let _ = SetWindowSubclass(
            hwnd,
            Some(no_activate_window_proc),
            NO_ACTIVATE_SUBCLASS_ID,
            0,
        );
        let _ = EnumChildWindows(Some(hwnd), Some(install_no_activate_on_child), LPARAM(0));
    }
    ensure_no_activate_hook(hwnd)
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
    // Keep the browser owner attached through destroy. When an owned window is
    // destroyed, Windows hands activation back to its owner; clearing the owner
    // first breaks that fallback, so the window manager can't reactivate the
    // browser and may minimize it during a resync's mass teardown (cf. The Old
    // New Thing on activation fallback when destroying an owned/active window).
    // Hidden with NOACTIVATE so hiding itself never reassigns activation.
    let _ = set_window_visible_without_activation(window, false);
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

pub fn apply_anchored_window_geometry(
    window: &Window,
    width: f64,
    height: f64,
    from_anchor_x: f64,
    from_anchor_y: f64,
    to_anchor_x: f64,
    to_anchor_y: f64,
) -> Result<(), String> {
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || !from_anchor_x.is_finite()
        || !from_anchor_y.is_finite()
        || !to_anchor_x.is_finite()
        || !to_anchor_y.is_finite()
    {
        return Err("Invalid surface geometry".into());
    }

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let x = position.x + ((from_anchor_x - to_anchor_x) * scale).round() as i32;
    let y = position.y + ((from_anchor_y - to_anchor_y) * scale).round() as i32;
    let physical_width = (width * scale).round().max(1.0) as i32;
    let physical_height = (height * scale).round().max(1.0) as i32;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            physical_width,
            physical_height,
            SWP_NOZORDER | SWP_NOACTIVATE,
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
    pub bar_pointer_inside: bool,
    pub height: f64,
    pub instance_uid: String,
    pub menu_uid: String,
    pub parent_label: String,
    pub payload: Value,
    pub request_uid: String,
    pub width: f64,
    pub window_uid: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct PopupAnchor {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupHitRect {
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
    pub top: f64,
}

fn apply_popup_hit_region(hwnd: HWND, scale: f64, rects: &[PopupHitRect]) -> Result<(), String> {
    unsafe {
        let combined = CreateRectRgn(0, 0, 0, 0);
        for rect in rects {
            let left = (rect.left * scale).floor() as i32;
            let top = (rect.top * scale).floor() as i32;
            let right = (rect.right * scale).ceil() as i32;
            let bottom = (rect.bottom * scale).ceil() as i32;
            if right <= left || bottom <= top {
                continue;
            }
            let part = CreateRectRgn(left, top, right, bottom);
            let _ = CombineRgn(Some(combined), Some(combined), Some(part), RGN_OR);
            let _ = DeleteObject(HGDIOBJ(part.0));
        }
        if SetWindowRgn(hwnd, Some(combined), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(combined.0));
            return Err("Failed to set popup hit region".into());
        }
    }
    Ok(())
}

pub fn set_popup_hit_regions(window: &Window, rects: &[PopupHitRect]) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    apply_popup_hit_region(hwnd, scale, rects)
}

pub fn clear_popup_hit_region(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    apply_popup_hit_region(hwnd, scale, &[])
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupSurface {
    pub instance_uid: String,
    pub menu_uid: String,
    pub parent_label: String,
    pub payload: Value,
    pub request_uid: String,
    pub window_uid: String,
}

#[derive(Clone)]
struct StoredPopup {
    anchor: PopupAnchor,
    bar_pointer_inside: bool,
    close_generation: u64,
    close_pending: Option<PopupCloseReason>,
    content_closed: bool,
    height: f64,
    popup_pointer_inside: bool,
    surface: PopupSurface,
    width: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PopupPointerSource {
    Bar,
    Popup,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PopupCloseReason {
    Intent,
    PointerExit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PopupPointerAction {
    None,
    Cancel,
    Schedule(u64),
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
            bar_pointer_inside: request.bar_pointer_inside,
            close_generation,
            close_pending: None,
            content_closed: false,
            height: request.height.clamp(POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT),
            popup_pointer_inside: false,
            surface: PopupSurface {
                instance_uid: request.instance_uid,
                menu_uid: request.menu_uid,
                parent_label: request.parent_label,
                payload: request.payload,
                request_uid: request.request_uid,
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
    ) -> Result<bool, String> {
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        if let Some(popup) = entries.get_mut(&popup_label(instance_uid, window_uid, menu_uid)) {
            if popup.content_closed {
                return Ok(false);
            }
            popup.close_generation = popup.close_generation.wrapping_add(1);
            popup.close_pending = None;
            return Ok(true);
        }
        Ok(false)
    }

    pub fn can_show(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
        request_uid: &str,
    ) -> bool {
        self.entries
            .lock()
            .ok()
            .and_then(|entries| {
                entries
                    .get(&popup_label(instance_uid, window_uid, menu_uid))
                    .map(|popup| popup.surface.request_uid == request_uid && !popup.content_closed)
            })
            .unwrap_or(false)
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
        if popup.content_closed {
            return Err("Popup content is already closed".into());
        }
        popup.close_generation = popup.close_generation.wrapping_add(1);
        popup.close_pending = Some(PopupCloseReason::Intent);
        Ok(popup.close_generation)
    }

    pub fn set_pointer_inside(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
        source: PopupPointerSource,
        inside: bool,
    ) -> Result<PopupPointerAction, String> {
        let mut entries = self.entries.lock().map_err(|_| "Popup lock failed")?;
        let popup = entries
            .get_mut(&popup_label(instance_uid, window_uid, menu_uid))
            .ok_or("Popup is unavailable")?;
        if popup.content_closed {
            return Ok(PopupPointerAction::None);
        }

        match source {
            PopupPointerSource::Bar => popup.bar_pointer_inside = inside,
            PopupPointerSource::Popup => popup.popup_pointer_inside = inside,
        }

        if popup.bar_pointer_inside || popup.popup_pointer_inside {
            if popup.close_pending == Some(PopupCloseReason::PointerExit) {
                popup.close_generation = popup.close_generation.wrapping_add(1);
                popup.close_pending = None;
                return Ok(PopupPointerAction::Cancel);
            }
            return Ok(PopupPointerAction::None);
        }

        if popup.close_pending.is_none() {
            popup.close_generation = popup.close_generation.wrapping_add(1);
            popup.close_pending = Some(PopupCloseReason::PointerExit);
            return Ok(PopupPointerAction::Schedule(popup.close_generation));
        }
        Ok(PopupPointerAction::None)
    }

    pub fn advance_close(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
        generation: u64,
    ) -> Option<u64> {
        let mut entries = self.entries.lock().ok()?;
        let popup = entries.get_mut(&popup_label(instance_uid, window_uid, menu_uid))?;
        if popup.close_pending.is_none() || popup.close_generation != generation {
            return None;
        }
        popup.close_generation = popup.close_generation.wrapping_add(1);
        popup.close_pending = None;
        popup.content_closed = true;
        Some(popup.close_generation)
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
pub struct AppliedGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub always_on_top: bool,
}

#[derive(Default)]
pub struct SurfaceRegistry {
    states: Mutex<HashMap<String, SurfaceState>>,
    geometries: Mutex<HashMap<String, AppliedGeometry>>,
    // Customizing is tracked orthogonally to visibility. It used to be a
    // SurfaceState variant, but visibility transitions (mark_visible /
    // mark_hidden fired when the menu's panel gains/loses focus) then clobbered
    // it, dropping the guard that keeps geometry sync from shrinking the
    // enlarged customize window back to the stored placement size.
    customizing: Mutex<HashSet<String>>,
}

impl SurfaceRegistry {
    pub fn geometry(&self, label: &str) -> Option<AppliedGeometry> {
        self.geometries.lock().ok()?.get(label).copied()
    }
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
        self.customizing
            .lock()
            .map(|set| set.contains(label))
            .unwrap_or(false)
    }

    pub fn set_customizing(&self, label: &str, customizing: bool) {
        if let Ok(mut set) = self.customizing.lock() {
            let changed = if customizing {
                set.insert(label.to_string())
            } else {
                set.remove(label)
            };
            if changed {
                eprintln!("[BrowseRail:Tauri:Surface:{label}] customizing -> {customizing}",);
            }
        }
    }

    pub fn is_visible(&self, label: &str) -> bool {
        matches!(self.state(label), SurfaceState::Visible)
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
        if let Ok(mut set) = self.customizing.lock() {
            set.retain(|label| !labels.contains(label));
        }
    }

    pub fn summary(&self) -> (usize, usize, usize) {
        let customizing = self.customizing.lock().map(|set| set.len()).unwrap_or(0);
        if let Ok(states) = self.states.lock() {
            let mut visible: usize = 0;
            let mut hidden: usize = 0;
            for state in states.values() {
                match state {
                    SurfaceState::Visible => visible += 1,
                    SurfaceState::Hidden | SurfaceState::Created => hidden += 1,
                }
            }
            // A customizing surface is also state=Visible; report it only under
            // the customizing count so the status string doesn't double-count.
            (visible.saturating_sub(customizing), customizing, hidden)
        } else {
            (0, customizing, 0)
        }
    }

    pub fn visible_labels(&self) -> Vec<String> {
        self.states
            .lock()
            .map(|states| {
                states
                    .iter()
                    .filter(|(_, state)| matches!(state, SurfaceState::Visible))
                    .map(|(label, _)| label.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}

pub fn open_popup(
    app: &tauri::AppHandle,
    popups: &PopupRegistry,
    request: PopupRequest,
) -> Result<(), String> {
    let popup = popups.set(request)?;
    let instance_uid = &popup.surface.instance_uid;
    let window_uid = &popup.surface.window_uid;
    let menu_uid = &popup.surface.menu_uid;
    let label = popup_label(instance_uid, window_uid, menu_uid);
    let parent = app
        .get_webview_window(&popup.surface.parent_label)
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

    if !is_new {
        set_window_visible_without_activation(&window, false)?;
    }
    place_popup(&parent, &window, &popup.anchor, popup.width, popup.height)?;
    if is_new {
        set_window_no_activate(&window)?;
        let parent_hwnd = parent.hwnd().map_err(|error| error.to_string())?;
        set_window_owner(&window, parent_hwnd.0 as isize)?;
    }
    let is_always_on_top = is_window_always_on_top(&parent).unwrap_or(false);
    let _ = set_window_always_on_top(&window, is_always_on_top);
    window
        .set_ignore_cursor_events(false)
        .map_err(|error| error.to_string())?;
    window
        .emit_to(&label, "popup-state", &popup.surface.payload)
        .map_err(|error| error.to_string())
}

pub fn show_popup(
    app: &tauri::AppHandle,
    surfaces: &SurfaceRegistry,
    popups: &PopupRegistry,
    instance_uid: &str,
    window_uid: &str,
    menu_uid: &str,
    request_uid: &str,
) -> bool {
    if !popups.can_show(instance_uid, window_uid, menu_uid, request_uid) {
        return false;
    }
    let label = popup_label(instance_uid, window_uid, menu_uid);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = set_window_visible_without_activation(&window, true);
        surfaces.mark_visible(&label);
        return true;
    }
    false
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
    let x = parent_position.x + (anchor.x * scale).round() as i32;
    let y = parent_position.y + (anchor.y * scale).round() as i32;
    let physical_width = (width * scale).round().max(1.0) as i32;
    let physical_height = (height * scale).round().max(1.0) as i32;
    let hwnd = popup.hwnd().map_err(|error| error.to_string())?;

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            physical_width,
            physical_height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())
    }
}

pub fn menu_position(
    window: &BrowserWindowSnapshot,
    placement: &MenuPlacement,
    width: f64,
    height: f64,
) -> LogicalPosition<f64> {
    let bounds = &window.bounds;
    let bound = &placement.bound_position;
    let x = match bound.anchor {
        MenuAnchor::TopLeft | MenuAnchor::BottomLeft => bounds.x + bound.offset_x,
        MenuAnchor::TopRight | MenuAnchor::BottomRight => {
            bounds.x + bounds.width - width - bound.offset_x
        }
    };
    let y = match bound.anchor {
        MenuAnchor::TopLeft | MenuAnchor::TopRight => bounds.y + bound.offset_y,
        MenuAnchor::BottomLeft | MenuAnchor::BottomRight => {
            bounds.y + bounds.height - height - bound.offset_y
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

/// Label for a free (detached) menu's floating surface. Keyed only by instance
/// + menu — there is exactly one per free menu, independent of browser windows.
/// It shares the `instance_surface_prefix("free", instance)` prefix.
pub fn free_label(instance_uid: &str, menu_uid: &str) -> String {
    format!(
        "free-{}-{}",
        safe_label_part(instance_uid),
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
