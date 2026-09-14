#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod protocol;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod session;

#[cfg(target_os = "windows")]
mod panel;
#[cfg(target_os = "windows")]
mod settings;
#[cfg(target_os = "windows")]
mod socket;

#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use protocol::{MenuAnchor, MenuPlacement, MenuSnapshot};
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
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "windows")]
use tauri_runtime::ResizeDirection;

#[cfg(target_os = "windows")]
const TRAY_ID: &str = "browserail";

#[cfg(target_os = "windows")]
pub struct AppState {
    display_panels: Arc<AtomicBool>,
    popups: Arc<panel::PopupRegistry>,
    registry: Arc<SessionRegistry>,
    socket: Arc<socket::SocketServer>,
}

#[cfg(target_os = "windows")]
impl AppState {
    fn displays_panels(&self) -> bool {
        self.display_panels.load(Ordering::Relaxed)
    }
}

#[cfg(target_os = "windows")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListenerState {
    address: String,
    error: Option<String>,
    listening: bool,
    port: u16,
}

#[cfg(target_os = "windows")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SurfaceState {
    kind: String,
    menu: Option<MenuSnapshot>,
    payload: Option<serde_json::Value>,
}

#[cfg(target_os = "windows")]
impl ListenerState {
    fn from_socket(status: socket::SocketStatus) -> Self {
        Self {
            address: format!("127.0.0.1:{}", status.port),
            error: status.error,
            listening: status.listening,
            port: status.port,
        }
    }
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
            let panel = state
                .registry
                .panel(&instance_uid, &window_uid)
                .ok_or("Panel state is unavailable")?;
            let menu = panel
                .menus
                .into_iter()
                .find(|menu| menu.uid == menu_uid)
                .ok_or("Menu state is unavailable")?;
            Ok(SurfaceState {
                kind: surface,
                menu: Some(menu),
                payload: None,
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
            })
        }
        _ => Err("Unknown surface type".into()),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_menu_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_menu_customization(window: tauri::Window) -> Result<(), String> {
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_menu_resize(window: tauri::Window, direction: String) -> Result<(), String> {
    let direction = match direction.as_str() {
        "east" => ResizeDirection::East,
        "south" => ResizeDirection::South,
        "southEast" => ResizeDirection::SouthEast,
        _ => return Err("Unknown resize direction".into()),
    };
    window
        .start_resize_dragging(direction)
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
) -> Result<MenuPlacement, String> {
    let panel = state
        .registry
        .panel(&instance_uid, &window_uid)
        .ok_or("Panel state is unavailable")?;
    if !panel.menus.iter().any(|menu| menu.uid == menu_uid) {
        return Err("Menu state is unavailable".into());
    }

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let x = f64::from(position.x) / scale;
    let y = f64::from(position.y) / scale;
    let width = f64::from(size.width) / scale;
    let height = f64::from(size.height) / scale;
    let bounds = panel.window.bounds;
    let offset_x = match anchor {
        MenuAnchor::TopLeft | MenuAnchor::BottomLeft => x - bounds.x,
        MenuAnchor::TopRight | MenuAnchor::BottomRight => bounds.x + bounds.width - x - width,
    };
    let offset_y = match anchor {
        MenuAnchor::TopLeft | MenuAnchor::TopRight => y - bounds.y,
        MenuAnchor::BottomLeft | MenuAnchor::BottomRight => bounds.y + bounds.height - y - height,
    };
    let placement = MenuPlacement {
        anchor,
        height,
        offset_x,
        offset_y,
        width,
    };
    state
        .registry
        .update_menu_placement(&instance_uid, menu_uid, placement.clone())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    Ok(placement)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn cancel_menu_customization(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let panel = state
        .registry
        .panel(&instance_uid, &window_uid)
        .ok_or("Panel state is unavailable")?;
    let menu = panel
        .menus
        .iter()
        .find(|menu| menu.uid == menu_uid)
        .ok_or("Menu state is unavailable")?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    panel::sync_menu(&app, &instance_uid, &panel, menu)
}

#[tauri::command]
fn open_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: panel::PopupRequest,
) -> Result<(), String> {
    if state
        .registry
        .panel(&request.instance_uid, &request.window_uid)
        .is_none_or(|panel| !panel.menus.iter().any(|menu| menu.uid == request.menu_uid))
    {
        return Err("The bound browser window is unavailable".into());
    }
    panel::open_popup(&app, &state.popups, request)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn resize_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (anchor, width, height) =
        state
            .popups
            .resize(&instance_uid, &window_uid, &menu_uid, width, height)?;
    panel::resize_popup(
        &app,
        &instance_uid,
        &window_uid,
        &menu_uid,
        &anchor,
        width,
        height,
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
    state
        .popups
        .cancel_close(&instance_uid, &window_uid, &menu_uid)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn schedule_popup_close(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let generation = state
        .popups
        .schedule_close(&instance_uid, &window_uid, &menu_uid)?;
    let popups = state.popups.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        if popups.remove_if_generation(&instance_uid, &window_uid, &menu_uid, generation) {
            panel::close_popup(&app, &popups, &instance_uid, &window_uid, &menu_uid);
        }
    });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn close_popup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) {
    panel::close_popup(&app, &state.popups, &instance_uid, &window_uid, &menu_uid);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn invoke_action(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    action_uid: String,
) -> Result<String, String> {
    state
        .registry
        .invoke(&instance_uid, &window_uid, action_uid)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn listener_state(state: tauri::State<'_, AppState>) -> ListenerState {
    ListenerState::from_socket(state.socket.status())
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn set_listener_port(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    port: u16,
) -> Result<ListenerState, String> {
    settings::validate_listener_port(port)?;
    let current = state.socket.status();
    if port == current.port && current.listening {
        return Ok(ListenerState::from_socket(current));
    }

    let listener = socket::bind(port).await?;
    settings::save(
        &app,
        &settings::DesktopSettings {
            display_panels: state.displays_panels(),
            listener_port: port,
        },
    )?;
    state
        .socket
        .replace(app.clone(), state.registry.clone(), listener, port)
        .await?;
    update_tray(&app).map_err(|error| error.to_string())?;
    Ok(ListenerState::from_socket(state.socket.status()))
}

#[cfg(target_os = "windows")]
fn tray_menu(
    app: &tauri::AppHandle,
    listener: &ListenerState,
    display_panels: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let listener_text = if listener.listening {
        format!("Listening on {}", listener.address)
    } else {
        format!("Not listening — {}", listener.address)
    };
    let listening = MenuItem::with_id(app, "listener_status", listener_text, false, None::<&str>)?;
    let display = CheckMenuItem::with_id(
        app,
        "display_panels",
        "Display panels",
        true,
        display_panels,
        None::<&str>,
    )?;
    let change_port = MenuItem::with_id(app, "change_port", "Change port…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&listening, &display, &change_port, &quit])
}

#[cfg(target_os = "windows")]
fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let listener = ListenerState::from_socket(state.socket.status());
    let menu = tray_menu(app.handle(), &listener, state.displays_panels())?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(tray_tooltip(&listener))
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "display_panels" => toggle_panel_display(app),
            "change_port" => open_listener_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn update_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let listener = ListenerState::from_socket(state.socket.status());
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
    tray.set_menu(Some(tray_menu(app, &listener, state.displays_panels())?))?;
    tray.set_tooltip(Some(tray_tooltip(&listener)))
}

#[cfg(target_os = "windows")]
fn tray_tooltip(listener: &ListenerState) -> String {
    if listener.listening {
        format!("BrowseRail — {}", listener.address)
    } else {
        format!("BrowseRail — not listening ({})", listener.address)
    }
}

#[cfg(target_os = "windows")]
fn toggle_panel_display(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let display_panels = !state.displays_panels();
    let settings = settings::DesktopSettings {
        display_panels,
        listener_port: state.socket.port(),
    };
    if settings::save(app, &settings).is_err() {
        return;
    }

    state
        .display_panels
        .store(display_panels, Ordering::Relaxed);
    for (instance_uid, panels) in state.registry.panel_snapshots() {
        if display_panels {
            let _ = panel::sync_panels(app, &state.popups, &instance_uid, &panels, &[]);
        } else {
            let window_uids = panels
                .iter()
                .map(|panel| panel.window.uid.clone())
                .collect::<Vec<_>>();
            panel::hide_panels(app, &state.popups, &instance_uid, &window_uids);
        }
    }
    let _ = update_tray(app);
}

#[cfg(target_os = "windows")]
fn open_listener_settings(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("listener-settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(
        app,
        "listener-settings",
        WebviewUrl::App("index.html?view=settings".into()),
    )
    .title("BrowseRail listener")
    .inner_size(420.0, 260.0)
    .resizable(false)
    .build();
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

#[cfg(target_os = "windows")]
pub fn run() {
    let display_panels = Arc::new(AtomicBool::new(true));
    let popups = Arc::new(panel::PopupRegistry::default());
    let registry = Arc::new(SessionRegistry::default());
    let socket = Arc::new(socket::SocketServer::default());
    let app = tauri::Builder::default()
        .manage(AppState {
            display_panels,
            popups,
            registry,
            socket,
        })
        .invoke_handler(tauri::generate_handler![
            surface_state,
            invoke_action,
            listener_state,
            set_listener_port,
            open_popup,
            resize_popup,
            cancel_popup_close,
            schedule_popup_close,
            close_popup,
            begin_menu_customization,
            start_menu_drag,
            start_menu_resize,
            save_menu_placement,
            cancel_menu_customization
        ])
        .setup(|app| {
            create_lifecycle_host(app)?;
            let settings = settings::load(app.handle()).unwrap_or_default();
            let state = app.state::<AppState>();
            state
                .display_panels
                .store(settings.display_panels, Ordering::Relaxed);
            match tauri::async_runtime::block_on(socket::bind(settings.listener_port)) {
                Ok(listener) => {
                    tauri::async_runtime::block_on(state.socket.replace(
                        app.handle().clone(),
                        state.registry.clone(),
                        listener,
                        settings.listener_port,
                    ))
                    .map_err(std::io::Error::other)?;
                }
                Err(error) => state.socket.mark_unavailable(settings.listener_port, error),
            }
            create_tray(app)?;
            Ok(())
        })
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
