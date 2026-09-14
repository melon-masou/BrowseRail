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
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;

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
use tokio::sync::mpsc::UnboundedSender;

#[cfg(target_os = "windows")]
pub const TRAY_ID: &str = "browserail";

#[cfg(target_os = "windows")]
pub struct TrayItems {
    pub server_item: MenuItem<tauri::Wry>,
    pub client_item: MenuItem<tauri::Wry>,
    pub surfaces_item: MenuItem<tauri::Wry>,
    pub display_panels_item: CheckMenuItem<tauri::Wry>,
}

#[cfg(target_os = "windows")]
pub struct TrayHolder(pub Arc<std::sync::Mutex<Option<TrayItems>>>);

#[cfg(target_os = "windows")]
pub struct AppState {
    pub display_panels: Arc<AtomicBool>,
    pub popups: Arc<panel::PopupRegistry>,
    pub registry: Arc<SessionRegistry>,
    pub socket: Arc<socket::SocketServer>,
    pub surfaces: Arc<panel::SurfaceRegistry>,
    pub native_sender: UnboundedSender<native::NativeCommand>,
    pub tray_holder: Arc<TrayHolder>,
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
#[tauri::command]
fn listener_state(state: tauri::State<'_, AppState>) -> ListenerState {
    let status = state.socket.status();
    ListenerState {
        address: format!("127.0.0.1:{}", status.port),
        error: status.error,
        listening: status.listening,
        port: status.port,
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn set_listener_port(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    port: u16,
) -> Result<(), String> {
    let settings = settings::DesktopSettings {
        display_panels: state.display_panels.load(Ordering::Relaxed),
        listener_port: port,
    };
    settings::save(&app, &settings)?;
    let listener = socket::bind(port).await?;
    state
        .socket
        .replace(state.native_sender.clone(), listener, port)
        .await?;
    let _ = state.native_sender.send(native::NativeCommand::UpdateTray);
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn invoke_action(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    action_uid: String,
) -> Result<String, String> {
    state.registry.invoke(&instance_uid, &window_uid, action_uid)
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
                .find(|entry| entry.uid == menu_uid)
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
fn open_popup(
    state: tauri::State<'_, AppState>,
    request: panel::PopupRequest,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::OpenPopup { request });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn resize_popup(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::ResizePopup {
        instance_uid,
        window_uid,
        menu_uid,
        width,
        height,
    });
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn cancel_popup_close(
    state: tauri::State<'_, AppState>,
    instance_uid: String,
    window_uid: String,
    menu_uid: String,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::CancelPopupClose {
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
    let _ = state.native_sender.send(native::NativeCommand::SchedulePopupClose {
        instance_uid,
        window_uid,
        menu_uid,
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
#[tauri::command]
fn begin_menu_customization(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
) -> Result<(), String> {
    let _ = state.native_sender.send(native::NativeCommand::BeginCustomization {
        label: window.label().to_string(),
    });
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn start_menu_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
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

    state.surfaces.set_customizing(window.label(), false);
    let _ = state.native_sender.send(native::NativeCommand::SaveMenuPlacement {
        instance_uid,
        window_uid,
        menu_uid,
        anchor,
        placement: placement.clone(),
    });
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
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
    let _ = state.native_sender.send(native::NativeCommand::CancelCustomization {
        instance_uid,
        window_uid,
        menu_uid,
    });
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn create_tray(app: &tauri::App, initial_display: bool) -> tauri::Result<TrayItems> {
    let server_item = MenuItem::with_id(
        app,
        "server_status",
        "○ Listener: Starting…",
        false,
        None::<&str>,
    )?;
    let client_item = MenuItem::with_id(
        app,
        "client_status",
        "○ Extension: Disconnected",
        false,
        None::<&str>,
    )?;
    let surfaces_item =
        MenuItem::with_id(app, "surfaces_status", "○ Menus: None", false, None::<&str>)?;
    let display = CheckMenuItem::with_id(
        app,
        "display_panels",
        "Display menus",
        true,
        initial_display,
        None::<&str>,
    )?;
    let change_port = MenuItem::with_id(app, "change_port", "Change port…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &server_item,
            &client_item,
            &surfaces_item,
            &display,
            &change_port,
            &quit,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("BrowseRail")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "display_panels" => {
                let state = app.state::<AppState>();
                let _ = state.native_sender.send(native::NativeCommand::ToggleDisplayPanels);
            }
            "change_port" => open_listener_settings(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(TrayItems {
        server_item,
        client_item,
        surfaces_item,
        display_panels_item: display,
    })
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
    let surfaces = Arc::new(panel::SurfaceRegistry::default());
    let tray_holder = Arc::new(TrayHolder(Arc::new(std::sync::Mutex::new(None))));

    let app = tauri::Builder::default()
        .setup({
            let display_panels = display_panels.clone();
            let popups = popups.clone();
            let registry = registry.clone();
            let socket = socket.clone();
            let surfaces = surfaces.clone();
            let tray_holder = tray_holder.clone();

            move |app| {
                create_lifecycle_host(app)?;
                let settings = settings::load(app.handle()).unwrap_or_default();
                display_panels.store(settings.display_panels, Ordering::Relaxed);

                let tray_items = create_tray(app, settings.display_panels)?;
                if let Ok(mut guard) = tray_holder.0.lock() {
                    *guard = Some(tray_items);
                }

                let native_sender = native::NativeReactor::start(
                    app.handle().clone(),
                    display_panels.clone(),
                    popups.clone(),
                    registry.clone(),
                    socket.clone(),
                    surfaces.clone(),
                    tray_holder.clone(),
                );

                app.manage(AppState {
                    display_panels,
                    popups,
                    registry,
                    socket: socket.clone(),
                    surfaces,
                    native_sender: native_sender.clone(),
                    tray_holder,
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
