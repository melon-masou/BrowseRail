pub mod debug;
pub mod i18n;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub mod protocol;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub mod session;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub mod state_machine;

#[cfg(target_os = "windows")]
pub mod native;
#[cfg(target_os = "windows")]
pub mod panel;
#[cfg(target_os = "windows")]
pub mod settings;
#[cfg(target_os = "windows")]
pub mod socket;

#[cfg(target_os = "windows")]
use std::collections::BTreeSet;
#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use protocol::{MenuAnchor, MenuBoundPosition, MenuPlacement, SurfaceMenu};
#[cfg(target_os = "windows")]
use serde::Serialize;
#[cfg(target_os = "windows")]
use session::SessionRegistry;
#[cfg(target_os = "windows")]
use tauri::Manager;
#[cfg(target_os = "windows")]
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
#[cfg(target_os = "windows")]
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "windows")]
use tauri::{Emitter, RunEvent, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "windows")]
use tokio::sync::mpsc::UnboundedSender;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::LPARAM;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    DEFAULT_CHARSET, EnumFontFamiliesExW, FONTENUMPROCW, GetDC, LOGFONTW, ReleaseDC, TEXTMETRICW,
};

#[cfg(target_os = "windows")]
pub const TRAY_ID: &str = "browserail";

#[cfg(target_os = "windows")]
pub struct AppState {
    pub display_panels: Arc<AtomicBool>,
    pub lock_editing: Arc<AtomicBool>,
    pub font_family: Arc<Mutex<String>>,
    pub popups: Arc<panel::PopupRegistry>,
    pub registry: Arc<SessionRegistry>,
    pub socket: Arc<socket::SocketServer>,
    pub surfaces: Arc<panel::SurfaceRegistry>,
    pub collapsed_menus: Arc<Mutex<Vec<settings::CollapsedMenu>>>,
    pub native_sender: UnboundedSender<native::NativeCommand>,
}

#[cfg(target_os = "windows")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenerState {
    address: String,
    error: Option<String>,
    listening: bool,
    port: u16,
    debug_enabled: bool,
    font_family: String,
    extensions: Vec<session::ConnectedExtension>,
}

#[cfg(target_os = "windows")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceState {
    kind: String,
    menu: Option<SurfaceMenu>,
    payload: Option<serde_json::Value>,
    collapsed: bool,
    font_family: String,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn listener_state(state: tauri::State<'_, AppState>) -> ListenerState {
    let status = state.socket.status();
    ListenerState {
        address: format!("127.0.0.1:{}", status.port),
        error: status.error,
        listening: status.listening,
        port: status.port,
        debug_enabled: crate::debug::is_debug_enabled(),
        font_family: state
            .font_family
            .lock()
            .map(|font| font.clone())
            .unwrap_or_else(|_| settings::DEFAULT_FONT_FAMILY.into()),
        extensions: state.registry.active_extensions(),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn set_listener_port(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    port: u16,
) -> Result<ListenerState, String> {
    let mut settings = settings::load(&app).unwrap_or_default();
    settings.listener_port = port;
    settings.display_panels = state.display_panels.load(Ordering::Relaxed);
    settings::save(&app, &settings)?;
    let listener = socket::bind(port).await?;
    state
        .socket
        .replace(state.native_sender.clone(), listener, port)
        .await?;
    let _ = state.native_sender.send(native::NativeCommand::UpdateTray);
    Ok(listener_state(state))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_debug_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<ListenerState, String> {
    crate::debug::set_debug_enabled(enabled);
    let mut settings = settings::load(&app).unwrap_or_default();
    settings.debug_enabled = enabled;
    settings.display_panels = state.display_panels.load(Ordering::Relaxed);
    settings::save(&app, &settings)?;
    Ok(listener_state(state))
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn collect_font_name(
    log_font: *const LOGFONTW,
    _metric: *const TEXTMETRICW,
    _font_type: u32,
    lparam: LPARAM,
) -> i32 {
    let Some(log_font) = (unsafe { log_font.as_ref() }) else {
        return 1;
    };
    let end = log_font
        .lfFaceName
        .iter()
        .position(|char| *char == 0)
        .unwrap_or(log_font.lfFaceName.len());
    let name = String::from_utf16_lossy(&log_font.lfFaceName[..end]);
    let fonts = unsafe { &mut *(lparam.0 as *mut BTreeSet<String>) };
    if name.starts_with('@') {
        fonts.insert(name[1..].into());
    } else {
        fonts.insert(name);
    }
    1
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn installed_fonts() -> Vec<String> {
    enumerate_installed_fonts()
}

#[cfg(target_os = "windows")]
fn enumerate_installed_fonts() -> Vec<String> {
    let mut fonts = BTreeSet::new();
    let dc = unsafe { GetDC(None) };
    if dc.is_invalid() {
        return Vec::new();
    }

    let log_font = LOGFONTW {
        lfCharSet: DEFAULT_CHARSET,
        ..Default::default()
    };
    let callback: FONTENUMPROCW = Some(collect_font_name);
    unsafe {
        EnumFontFamiliesExW(
            dc,
            &log_font,
            callback,
            LPARAM(&mut fonts as *mut BTreeSet<String> as isize),
            0,
        );
        ReleaseDC(None, dc);
    }
    fonts.into_iter().collect()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_font_family(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    font_family: String,
) -> Result<ListenerState, String> {
    let font_family = font_family.trim().to_string();
    if !enumerate_installed_fonts().contains(&font_family) {
        return Err("Font is not installed".into());
    }

    let mut settings = settings::load(&app).unwrap_or_default();
    settings.font_family = font_family.clone();
    settings.display_panels = state.display_panels.load(Ordering::Relaxed);
    settings.lock_editing = state.lock_editing.load(Ordering::Relaxed);
    settings::save(&app, &settings)?;

    *state
        .font_family
        .lock()
        .map_err(|_| "Font family lock failed")? = font_family.clone();
    let _ = app.emit("font-family-changed", font_family);
    Ok(listener_state(state))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn invoke_action(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    action_uid: String,
) -> Result<(), String> {
    state
        .registry
        .invoke(&instance_uid, &window_uid, action_uid)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn is_editing_locked(state: tauri::State<'_, AppState>) -> bool {
    state.lock_editing.load(Ordering::Relaxed)
}

#[cfg(target_os = "windows")]
fn is_menu_collapsed(
    state: &tauri::State<'_, AppState>,
    instance_uid: &str,
    menu_uid: &str,
) -> bool {
    state
        .collapsed_menus
        .lock()
        .map(|collapsed| {
            collapsed
                .iter()
                .any(|item| item.instance_uid == instance_uid && item.menu_uid == menu_uid)
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn set_menu_collapsed(
    app: &tauri::AppHandle,
    collapsed_menus: &Arc<Mutex<Vec<settings::CollapsedMenu>>>,
    instance_uid: &str,
    menu_uid: &str,
    collapsed: bool,
) -> Result<(), String> {
    let mut menus = collapsed_menus
        .lock()
        .map_err(|_| "Collapsed menu lock failed")?;
    let index = menus
        .iter()
        .position(|item| item.instance_uid == instance_uid && item.menu_uid == menu_uid);
    if collapsed {
        if index.is_none() {
            menus.push(settings::CollapsedMenu {
                instance_uid: instance_uid.into(),
                menu_uid: menu_uid.into(),
            });
        }
    } else if let Some(index) = index {
        menus.remove(index);
    }

    drop(menus);
    persist_collapsed_menus(app, collapsed_menus)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn toggle_menu_collapsed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    menu_uid: String,
) -> Result<bool, String> {
    let next = !is_menu_collapsed(&state, &instance_uid, &menu_uid);
    set_menu_collapsed(&app, &state.collapsed_menus, &instance_uid, &menu_uid, next)?;
    Ok(next)
}

#[cfg(target_os = "windows")]
fn persist_collapsed_menus(
    app: &tauri::AppHandle,
    collapsed_menus: &Arc<Mutex<Vec<settings::CollapsedMenu>>>,
) -> Result<(), String> {
    let menus = collapsed_menus
        .lock()
        .map_err(|_| "Collapsed menu lock failed")?
        .clone();
    let mut settings = settings::load(app).unwrap_or_default();
    settings.collapsed_menus = menus;
    settings::save(app, &settings)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn invoke_free_action(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    menu_uid: String,
    action_uid: String,
) -> Result<(), String> {
    state
        .registry
        .invoke_free(&instance_uid, menu_uid, action_uid)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn update_free_placement(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    menu_uid: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    state
        .registry
        .update_free_placement(&instance_uid, menu_uid, x, y)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn free_surface_state(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    menu_uid: String,
) -> Result<SurfaceState, String> {
    let menu = state.registry.free_menu(&instance_uid, &menu_uid);
    crate::debug::log(
        "Native:Free",
        format!(
            "free_surface_state inst={instance_uid} menu={menu_uid} found={}",
            menu.is_some()
        ),
    );
    let menu = SurfaceMenu::from_synced(&menu.ok_or("Free menu state is unavailable")?);
    let collapsed = is_menu_collapsed(&state, &instance_uid, &menu_uid);
    Ok(SurfaceState {
        kind: "menu".into(),
        menu: Some(menu),
        payload: None,
        collapsed,
        font_family: current_font_family(&state),
    })
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn surface_available_height(window: tauri::Window, above: bool) -> Result<f64, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let top = f64::from(position.y) / scale;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("Current monitor is unavailable")?;
    let work_area = monitor.work_area();
    let work_top = f64::from(work_area.position.y) / scale;
    let work_bottom = (f64::from(work_area.position.y) + f64::from(work_area.size.height)) / scale;
    Ok(if above {
        (top - work_top).max(0.0)
    } else {
        (work_bottom - top).max(0.0)
    })
}

#[cfg(target_os = "windows")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HorizontalSpace {
    anchor_left: f64,
    anchor_right: f64,
    left: f64,
    right: f64,
    window_left: f64,
    work_left: f64,
    work_right: f64,
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn surface_horizontal_space(
    window: tauri::Window,
    anchor_left: f64,
    anchor_right: f64,
) -> Result<HorizontalSpace, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("Current monitor is unavailable")?;
    let work_area = monitor.work_area();
    let window_left = f64::from(position.x) / scale;
    let work_left = f64::from(work_area.position.x) / scale;
    let work_right = (f64::from(work_area.position.x) + f64::from(work_area.size.width)) / scale;
    let anchor_left_screen = window_left + anchor_left;
    let anchor_right_screen = window_left + anchor_right;
    Ok(HorizontalSpace {
        anchor_left: anchor_left_screen,
        anchor_right: anchor_right_screen,
        left: (anchor_left_screen - work_left).max(0.0),
        right: (work_right - anchor_right_screen).max(0.0),
        window_left,
        work_left,
        work_right,
    })
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn surface_state(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    surface: String,
) -> Result<SurfaceState, String> {
    match surface.as_str() {
        "menu" => {
            let menu = state
                .registry
                .menu(&instance_uid, &window_uid, &menu_uid)
                .ok_or("Menu state is unavailable")?;
            let menu = SurfaceMenu::from_synced(&menu);
            let collapsed = is_menu_collapsed(&state, &instance_uid, &menu_uid);
            Ok(SurfaceState {
                kind: surface,
                menu: Some(menu),
                payload: None,
                collapsed,
                font_family: current_font_family(&state),
            })
        }
        "popup" => {
            let popup = state
                .popups
                .surface(&instance_uid, &window_uid, &menu_uid)
                .ok_or("Popup state is unavailable")?;
            Ok(SurfaceState {
                kind: surface,
                menu: None,
                payload: Some(popup.payload),
                collapsed: false,
                font_family: current_font_family(&state),
            })
        }
        _ => Err("Unknown surface type".into()),
    }
}

#[cfg(target_os = "windows")]
fn current_font_family(state: &tauri::State<'_, AppState>) -> String {
    state
        .font_family
        .lock()
        .map(|font| font.clone())
        .unwrap_or_else(|_| settings::DEFAULT_FONT_FAMILY.into())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_popup(
    state: tauri::State<'_, AppState>,
    request: panel::PopupRequest,
) -> Result<(), String> {
    let _ = state
        .native_sender
        .send(native::NativeCommand::OpenPopup { request });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn show_popup(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    request_uid: String,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::ShowPopup {
        instance_uid,
        window_uid,
        menu_uid,
        request_uid,
    });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_popup_hit_regions(
    window: tauri::Window,
    rects: Vec<panel::PopupHitRect>,
) -> Result<(), String> {
    panel::set_popup_hit_regions(&window, &rects)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn resize_and_position(
    window: tauri::Window,
    width: f64,
    height: f64,
    from_anchor_x: f64,
    from_anchor_y: f64,
    to_anchor_x: f64,
    to_anchor_y: f64,
) -> Result<(), String> {
    panel::apply_anchored_window_geometry(
        &window,
        width,
        height,
        from_anchor_x,
        from_anchor_y,
        to_anchor_x,
        to_anchor_y,
    )
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn cancel_popup_close(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let _ = state
        .native_sender
        .send(native::NativeCommand::CancelPopupClose {
            instance_uid,
            window_uid,
            menu_uid,
        });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn schedule_popup_close(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let _ = state
        .native_sender
        .send(native::NativeCommand::SchedulePopupClose {
            instance_uid,
            window_uid,
            menu_uid,
        });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_popup_pointer_inside(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    source: panel::PopupPointerSource,
    inside: bool,
) -> Result<(), String> {
    let _ = state
        .native_sender
        .send(native::NativeCommand::SetPopupPointerInside {
            instance_uid,
            window_uid,
            menu_uid,
            source,
            inside,
        });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn close_popup(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::ClosePopup {
        instance_uid,
        window_uid,
        menu_uid,
    });
    Ok(())
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomizationStartInfo {
    pub toolbar_position: String,
}

#[cfg(target_os = "windows")]
const CUSTOMIZE_ICON_SIZE: f64 = 26.0;

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_menu_customization(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    toolbar_space: f64,
    anchor_offset_y: f64,
    menu_height: f64,
) -> Result<CustomizationStartInfo, String> {
    let is_free = window_uid.is_empty();
    if !is_free {
        state.popups.remove(&instance_uid, &window_uid, &menu_uid);
    }

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let menu_y = f64::from(position.y) / scale + anchor_offset_y;
    if !toolbar_space.is_finite()
        || toolbar_space < 0.0
        || !anchor_offset_y.is_finite()
        || !menu_height.is_finite()
        || menu_height <= 0.0
    {
        return Err("Invalid customization toolbar geometry".into());
    }

    let (space_above, space_below) = if let Ok(Some(monitor)) = window.current_monitor() {
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let m_top = f64::from(m_pos.y) / scale;
        let m_bottom = m_top + f64::from(m_size.height) / scale;
        (menu_y - m_top, m_bottom - (menu_y + menu_height))
    } else {
        (menu_y, 800.0)
    };

    let toolbar_position =
        if space_above >= toolbar_space && (space_below < toolbar_space || menu_y > 150.0) {
            "top".to_string()
        } else if space_below >= toolbar_space {
            "bottom".to_string()
        } else if space_above >= space_below {
            "top".to_string()
        } else {
            "bottom".to_string()
        };

    state.surfaces.set_customizing(window.label(), true);
    let _ = state
        .native_sender
        .send(native::NativeCommand::BeginCustomization {
            label: window.label().to_string(),
        });

    Ok(CustomizationStartInfo { toolbar_position })
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_menu_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn move_free_surface(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    if !window.label().starts_with("free-") {
        return Err("Only free surfaces can be moved directly".into());
    }
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_menu_placement(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    anchor: MenuAnchor,
    width: f64,
    height: f64,
    anchor_offset_x: f64,
    anchor_offset_y: f64,
) -> Result<MenuPlacement, String> {
    // Free (detached) menus have no owning window, so bounds/anchor math has no
    // meaning for them. Use the session-stored free snapshot for the original
    // placement, and simply persist the new size as a free placement.
    let is_free = window_uid.is_empty();
    let orig_menu = if is_free {
        state
            .registry
            .free_menu(&instance_uid, &menu_uid)
            .ok_or("Free menu state is unavailable")?
    } else {
        state
            .registry
            .menu(&instance_uid, &window_uid, &menu_uid)
            .ok_or("Menu state is unavailable")?
    };

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let x = f64::from(position.x) / scale + anchor_offset_x;
    let y = f64::from(position.y) / scale + anchor_offset_y;
    if !width.is_finite()
        || !height.is_finite()
        || !anchor_offset_x.is_finite()
        || !anchor_offset_y.is_finite()
    {
        return Err("Invalid menu size".into());
    }
    let mut width = width;
    let mut height = height;

    match orig_menu.view.orientation {
        protocol::MenuOrientation::Row => {
            width = width.clamp(CUSTOMIZE_ICON_SIZE, 2000.0);
            height = height.clamp(CUSTOMIZE_ICON_SIZE, 64.0);
        }
        protocol::MenuOrientation::Column => {
            width = width.clamp(CUSTOMIZE_ICON_SIZE, 220.0);
            height = height.clamp(CUSTOMIZE_ICON_SIZE, 1600.0);
        }
    }

    // Free mode has no owner rectangle to anchor against; reuse the saved
    // placement's offsets and anchor unchanged, store the screen position as
    // free_position instead.
    let (offset_x, offset_y) = if is_free {
        (
            orig_menu.placement.bound_position.offset_x,
            orig_menu.placement.bound_position.offset_y,
        )
    } else {
        let bounds = state
            .registry
            .window_snapshot(&instance_uid, &window_uid)
            .map(|window| window.bounds)
            .ok_or("Browser window state is unavailable")?;
        let offset_x = match anchor {
            MenuAnchor::TopLeft | MenuAnchor::BottomLeft => x - bounds.x,
            MenuAnchor::TopRight | MenuAnchor::BottomRight => bounds.x + bounds.width - x - width,
        };
        let offset_y = match anchor {
            MenuAnchor::TopLeft | MenuAnchor::TopRight => y - bounds.y,
            MenuAnchor::BottomLeft | MenuAnchor::BottomRight => {
                bounds.y + bounds.height - y - height
            }
        };
        (offset_x, offset_y)
    };

    // Derive the per-track size with the exact same track count and gap the
    // grid renders with (and that native::recompute_menu_total_size inverts),
    // so a save without a drag round-trips back to the same total instead of
    // growing every time.
    let track_count = protocol::menu_track_count(&orig_menu.view.items);
    let item_gap = protocol::menu_gap(&orig_menu.view);
    let (item_width, item_height) = match orig_menu.view.orientation {
        protocol::MenuOrientation::Row => {
            let iw = ((width - (track_count - 1.0) * item_gap) / track_count).max(1.0);
            (Some(iw), Some(height))
        }
        protocol::MenuOrientation::Column => {
            let ih = ((height - (track_count - 1.0) * item_gap) / track_count).max(1.0);
            (Some(width), Some(ih))
        }
    };

    let anchor = if is_free {
        orig_menu.placement.bound_position.anchor
    } else {
        anchor
    };
    let placement = MenuPlacement {
        bound_position: MenuBoundPosition {
            anchor,
            offset_x,
            offset_y,
        },
        // Preserve the free position; a resize/drag never recomputes it here
        // (free drags go through update_free_placement).
        free_position: orig_menu.placement.free_position,
        item_width,
        item_height,
    };

    state.surfaces.set_customizing(window.label(), false);
    let _ = state
        .native_sender
        .send(native::NativeCommand::SaveMenuPlacement {
            instance_uid,
            window_uid: window_uid.clone(),
            menu_uid,
            anchor,
            placement,
        });
    Ok(placement)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn cancel_menu_customization(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    state.surfaces.set_customizing(window.label(), false);
    let _ = state
        .native_sender
        .send(native::NativeCommand::CancelCustomization {
            instance_uid,
            window_uid,
            menu_uid,
        });
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn build_tray_menu<M: Manager<tauri::Wry>>(
    manager: &M,
    state: &native::TrayStateSnapshot,
) -> tauri::Result<Menu<tauri::Wry>> {
    let server_item = MenuItem::with_id(
        manager,
        "server_status",
        &state.server_text,
        false,
        None::<&str>,
    )?;

    let mut ext_items = Vec::new();
    for (i, line) in state.extension_lines.iter().enumerate() {
        let item = MenuItem::with_id(manager, format!("ext_item_{i}"), line, false, None::<&str>)?;
        ext_items.push(item);
    }

    let surfaces_item = MenuItem::with_id(
        manager,
        "surfaces_status",
        &state.surfaces_text,
        false,
        None::<&str>,
    )?;
    let display = CheckMenuItem::with_id(
        manager,
        "display_panels",
        i18n::Msg::DisplayMenus.localized(),
        true,
        state.display_panels,
        None::<&str>,
    )?;
    let lock_editing = CheckMenuItem::with_id(
        manager,
        "lock_editing",
        i18n::Msg::LockEditing.localized(),
        true,
        state.lock_editing,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        manager,
        "settings",
        i18n::Msg::Settings.localized(),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        manager,
        "quit",
        i18n::Msg::Quit.localized(),
        true,
        None::<&str>,
    )?;

    let mut menu_items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    menu_items.push(&server_item);
    for ext_item in &ext_items {
        menu_items.push(ext_item);
    }
    menu_items.push(&surfaces_item);
    menu_items.push(&display);
    menu_items.push(&lock_editing);
    menu_items.push(&settings);
    menu_items.push(&quit);

    Menu::with_items(manager, &menu_items)
}

#[cfg(target_os = "windows")]
fn create_tray(app: &tauri::App, initial_display: bool, initial_lock: bool) -> tauri::Result<()> {
    let initial_state = native::TrayStateSnapshot {
        server_text: i18n::Msg::ListenerStarting.localized(),
        extension_lines: vec![i18n::Msg::ExtensionDisconnected.localized()],
        surfaces_text: i18n::Msg::MenusNone.localized(),
        tooltip: "BrowseRail".into(),
        display_panels: initial_display,
        lock_editing: initial_lock,
    };
    let menu = build_tray_menu(app, &initial_state)?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("BrowseRail")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "display_panels" => {
                let state = app.state::<AppState>();
                let _ = state
                    .native_sender
                    .send(native::NativeCommand::ToggleDisplayPanels);
            }
            "lock_editing" => {
                let state = app.state::<AppState>();
                let _ = state
                    .native_sender
                    .send(native::NativeCommand::ToggleLockEditing);
            }
            "settings" => open_listener_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_listener_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("listener-settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok();
    let mut builder = WebviewWindowBuilder::new(
        app,
        "listener-settings",
        WebviewUrl::App("index.html?view=settings".into()),
    )
    .title(i18n::Msg::WindowSettingsTitle.localized())
    .inner_size(440.0, 380.0)
    .min_inner_size(360.0, 260.0)
    .resizable(true);

    if let Some(icon) = icon {
        builder = builder.icon(icon).expect("valid settings window icon");
    }
    let _ = builder.build();
}

#[cfg(target_os = "windows")]
fn create_lifecycle_host(app: &tauri::App) -> tauri::Result<()> {
    WebviewWindowBuilder::new(
        app,
        "lifecycle-host",
        WebviewUrl::App("index.html?view=host".into()),
    )
    .title("BrowseRail host")
    .inner_size(1.0, 1.0)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false)
    .build()?;
    Ok(())
}

/// Set the UI language for the Rust-rendered tray/menu and refresh it. The frontend
/// resolves the language (stored choice or webview locale) and pushes it here.
#[cfg(target_os = "windows")]
#[tauri::command]
fn set_ui_language(language: String, state: tauri::State<'_, AppState>) {
    if let Some(lang) = i18n::Lang::from_code(&language) {
        i18n::set_language(lang);
        let _ = state.native_sender.send(native::NativeCommand::UpdateTray);
    }
}

#[cfg(target_os = "windows")]
pub fn run() {
    let display_panels = Arc::new(AtomicBool::new(true));
    let lock_editing = Arc::new(AtomicBool::new(false));
    let font_family = Arc::new(Mutex::new(settings::DEFAULT_FONT_FAMILY.into()));
    let popups = Arc::new(panel::PopupRegistry::default());
    let registry = Arc::new(SessionRegistry::default());
    let socket = Arc::new(socket::SocketServer::default());
    let surfaces = Arc::new(panel::SurfaceRegistry::default());
    let collapsed_menus = Arc::new(Mutex::new(Vec::new()));

    let app = tauri::Builder::default()
        .setup({
            let display_panels = display_panels.clone();
            let lock_editing = lock_editing.clone();
            let font_family = font_family.clone();
            let popups = popups.clone();
            let registry = registry.clone();
            let socket = socket.clone();
            let surfaces = surfaces.clone();
            let collapsed_menus = collapsed_menus.clone();

            move |app| {
                create_lifecycle_host(app)?;
                let settings = settings::load(app.handle()).unwrap_or_default();
                *collapsed_menus
                    .lock()
                    .expect("collapsed menu lock poisoned") = settings.collapsed_menus.clone();
                display_panels.store(settings.display_panels, Ordering::Relaxed);
                lock_editing.store(settings.lock_editing, Ordering::Relaxed);
                *font_family.lock().expect("font family lock poisoned") =
                    settings.font_family.clone();
                crate::debug::set_debug_enabled(settings.debug_enabled);
                i18n::set_language(i18n::detect_system_lang());

                create_tray(app, settings.display_panels, settings.lock_editing)?;

                let native_sender = native::NativeReactor::start(
                    app.handle().clone(),
                    display_panels.clone(),
                    lock_editing.clone(),
                    popups.clone(),
                    registry.clone(),
                    socket.clone(),
                    surfaces.clone(),
                    collapsed_menus.clone(),
                );

                app.manage(AppState {
                    display_panels,
                    lock_editing,
                    font_family,
                    popups,
                    registry,
                    socket: socket.clone(),
                    surfaces,
                    collapsed_menus: collapsed_menus.clone(),
                    native_sender: native_sender.clone(),
                });

                let app_handle = app.handle().clone();
                let port = settings.listener_port;
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    match socket::bind(port).await {
                        Ok(listener) => {
                            let _ = socket
                                .replace(state.native_sender.clone(), listener, port)
                                .await;
                            let _ = state.native_sender.send(native::NativeCommand::UpdateTray);
                        }
                        Err(err) => {
                            socket.mark_unavailable(port, err);
                            let _ = state.native_sender.send(native::NativeCommand::UpdateTray);
                        }
                    }
                });

                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            surface_state,
            toggle_menu_collapsed,
            surface_available_height,
            surface_horizontal_space,
            invoke_action,
            invoke_free_action,
            update_free_placement,
            free_surface_state,
            is_editing_locked,
            listener_state,
            set_listener_port,
            set_debug_enabled,
            installed_fonts,
            set_font_family,
            open_popup,
            show_popup,
            set_popup_hit_regions,
            resize_and_position,
            cancel_popup_close,
            schedule_popup_close,
            set_popup_pointer_inside,
            close_popup,
            begin_menu_customization,
            start_menu_drag,
            move_free_surface,
            save_menu_placement,
            cancel_menu_customization,
            set_ui_language
        ])
        .build(tauri::generate_context!())
        .expect("BrowseRail failed to start");

    app.run(|_, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event
            && code.is_none()
        {
            api.prevent_exit();
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn run() {
    eprintln!("BrowseRail desktop is Windows-first");
}
