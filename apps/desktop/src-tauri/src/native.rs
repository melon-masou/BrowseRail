use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use uuid::Uuid;

use crate::panel::{
    menu_label, menu_position, popup_label, surface_prefix, PopupRegistry, PopupRequest,
    SurfaceRegistry,
};
use crate::protocol::{
    ActionResultPayload, BrowserInstance, BrowserWindowState, MenuAnchor, MenuPlacement,
    MenuSnapshot, PanelSnapshot, ServerMessage,
};
use crate::session::SessionRegistry;
use crate::socket::SocketServer;
use crate::TrayHolder;

#[derive(Clone, Debug)]
pub struct TrayStateSnapshot {
    pub server_text: String,
    pub client_text: String,
    pub surfaces_text: String,
    pub tooltip: String,
    pub display_panels: bool,
}

pub enum NativeCommand {
    ClientRegistered {
        connection_uid: Uuid,
        instance: BrowserInstance,
        outgoing: UnboundedSender<ServerMessage>,
    },
    ClientDisconnected {
        connection_uid: Uuid,
    },
    SyncPanels {
        connection_uid: Uuid,
        revision: u64,
        panels: Vec<PanelSnapshot>,
    },
    ActionResult {
        request_uid: String,
        ok: bool,
        message: Option<String>,
    },
    OpenPopup {
        request: PopupRequest,
    },
    ResizePopup {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        width: f64,
        height: f64,
    },
    SchedulePopupClose {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    CancelPopupClose {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    ClosePopupIfGeneration {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        generation: u64,
    },
    ClosePopup {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    BeginCustomization {
        label: String,
    },
    SaveMenuPlacement {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        anchor: MenuAnchor,
        placement: MenuPlacement,
    },
    CancelCustomization {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    ToggleDisplayPanels,
    UpdateTray,
}

struct MenuSyncItem {
    label: String,
    url: String,
    target_pos: tauri::LogicalPosition<f64>,
    placement: MenuPlacement,
    always_on_top: bool,
    is_minimized: bool,
    is_customizing: bool,
    geometry_changed: bool,
    menu: MenuSnapshot,
}

pub struct NativeReactor {
    app: AppHandle,
    display_panels: Arc<AtomicBool>,
    popups: Arc<PopupRegistry>,
    registry: Arc<SessionRegistry>,
    socket: Arc<SocketServer>,
    surfaces: Arc<SurfaceRegistry>,
    tray_holder: Arc<TrayHolder>,
    native_sender: UnboundedSender<NativeCommand>,
    last_tray: Option<TrayStateSnapshot>,
}

impl NativeReactor {
    pub fn start(
        app: AppHandle,
        display_panels: Arc<AtomicBool>,
        popups: Arc<PopupRegistry>,
        registry: Arc<SessionRegistry>,
        socket: Arc<SocketServer>,
        surfaces: Arc<SurfaceRegistry>,
        tray_holder: Arc<TrayHolder>,
    ) -> UnboundedSender<NativeCommand> {
        let (sender, receiver) = unbounded_channel::<NativeCommand>();
        let mut reactor = Self {
            app,
            display_panels,
            popups,
            registry,
            socket,
            surfaces,
            tray_holder,
            native_sender: sender.clone(),
            last_tray: None,
        };

        tauri::async_runtime::spawn(async move {
            reactor.run(receiver).await;
        });

        sender
    }

    async fn run(&mut self, mut receiver: UnboundedReceiver<NativeCommand>) {
        while let Some(cmd) = receiver.recv().await {
            match cmd {
                NativeCommand::ClientRegistered {
                    connection_uid,
                    instance,
                    outgoing,
                } => {
                    self.registry.register(connection_uid, instance, outgoing.clone());
                    let _ = outgoing.send(ServerMessage::Ready {
                        protocol_version: crate::protocol::PROTOCOL_VERSION,
                    });
                    self.check_update_tray();
                }
                NativeCommand::ClientDisconnected { connection_uid } => {
                    if let Some((instance_uid, window_uids)) =
                        self.registry.disconnect(connection_uid)
                    {
                        self.hide_instance_windows(&instance_uid, &window_uids);
                        self.check_update_tray();
                    }
                }
                NativeCommand::SyncPanels {
                    connection_uid,
                    revision,
                    panels,
                } => {
                    if let Ok(Some(outcome)) = self.registry.sync(connection_uid, revision, panels)
                    {
                        self.handle_sync_outcome(outcome);
                        self.check_update_tray();
                    }
                }
                NativeCommand::ActionResult {
                    request_uid,
                    ok,
                    message,
                } => {
                    if let Some(action) = self.registry.resolve_action(&request_uid) {
                        let app = self.app.clone();
                        let payload = ActionResultPayload { ok, message };
                        let _ = self.app.run_on_main_thread(move || {
                            crate::panel::emit_action_result(
                                &app,
                                &action.instance_uid,
                                &action.window_uid,
                                &payload,
                            );
                        });
                    }
                }
                NativeCommand::OpenPopup { request } => {
                    let app = self.app.clone();
                    let surfaces = self.surfaces.clone();
                    let popups = self.popups.clone();
                    let _ = self.app.run_on_main_thread(move || {
                        let _ = crate::panel::open_popup(&app, &surfaces, &popups, request);
                    });
                }
                NativeCommand::ResizePopup {
                    instance_uid,
                    window_uid,
                    menu_uid,
                    width,
                    height,
                } => {
                    let app = self.app.clone();
                    let popups = self.popups.clone();
                    if let Ok((anchor, w, h)) =
                        popups.resize(&instance_uid, &window_uid, &menu_uid, width, height)
                    {
                        let _ = self.app.run_on_main_thread(move || {
                            let _ = crate::panel::resize_popup(
                                &app,
                                &instance_uid,
                                &window_uid,
                                &menu_uid,
                                &anchor,
                                w,
                                h,
                            );
                        });
                    }
                }
                NativeCommand::SchedulePopupClose {
                    instance_uid,
                    window_uid,
                    menu_uid,
                } => {
                    if let Ok(generation) = self
                        .popups
                        .schedule_close(&instance_uid, &window_uid, &menu_uid)
                    {
                        let sender = self.native_sender.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(250)).await;
                            let _ = sender.send(NativeCommand::ClosePopupIfGeneration {
                                instance_uid,
                                window_uid,
                                menu_uid,
                                generation,
                            });
                        });
                    }
                }
                NativeCommand::CancelPopupClose {
                    instance_uid,
                    window_uid,
                    menu_uid,
                } => {
                    let _ = self
                        .popups
                        .cancel_close(&instance_uid, &window_uid, &menu_uid);
                }
                NativeCommand::ClosePopupIfGeneration {
                    instance_uid,
                    window_uid,
                    menu_uid,
                    generation,
                } => {
                    if self.popups.remove_if_generation(
                        &instance_uid,
                        &window_uid,
                        &menu_uid,
                        generation,
                    ) {
                        self.hide_popup_window(&instance_uid, &window_uid, &menu_uid);
                    }
                }
                NativeCommand::ClosePopup {
                    instance_uid,
                    window_uid,
                    menu_uid,
                } => {
                    self.popups.remove(&instance_uid, &window_uid, &menu_uid);
                    self.hide_popup_window(&instance_uid, &window_uid, &menu_uid);
                }
                NativeCommand::BeginCustomization { label } => {
                    self.surfaces.set_customizing(&label, true);
                    self.check_update_tray();
                }
                NativeCommand::SaveMenuPlacement {
                    instance_uid,
                    window_uid: _,
                    menu_uid,
                    anchor: _,
                    placement,
                } => {
                    let _ = self.registry.update_menu_placement(
                        &instance_uid,
                        menu_uid,
                        placement,
                    );
                    self.check_update_tray();
                }
                NativeCommand::CancelCustomization {
                    instance_uid: _,
                    window_uid: _,
                    menu_uid: _,
                } => {
                    self.check_update_tray();
                }
                NativeCommand::ToggleDisplayPanels => {
                    let next = !self.display_panels.load(Ordering::Relaxed);
                    self.display_panels.store(next, Ordering::Relaxed);
                    let settings = crate::settings::DesktopSettings {
                        display_panels: next,
                        listener_port: self.socket.port(),
                    };
                    let _ = crate::settings::save(&self.app, &settings);

                    for (instance_uid, panels) in self.registry.panel_snapshots() {
                        if next {
                            self.handle_sync_outcome(crate::session::SyncOutcome {
                                instance_uid,
                                panels,
                                removed_window_uids: Vec::new(),
                            });
                        } else {
                            let window_uids = panels
                                .iter()
                                .map(|panel| panel.window.uid.clone())
                                .collect::<Vec<_>>();
                            self.hide_instance_windows(&instance_uid, &window_uids);
                        }
                    }
                    self.check_update_tray();
                }
                NativeCommand::UpdateTray => {
                    self.check_update_tray();
                }
            }
        }
    }

    fn hide_instance_windows(&self, instance_uid: &str, window_uids: &[String]) {
        let mut labels = Vec::new();
        for window_uid in window_uids {
            let menu_prefix = surface_prefix("menu", instance_uid, window_uid);
            let popup_prefix = surface_prefix("popup", instance_uid, window_uid);
            for (label, _) in self.app.webview_windows() {
                if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                    labels.push(label);
                }
            }
        }
        for label in &labels {
            self.surfaces.mark_hidden(label);
        }
        if !labels.is_empty() {
            let app = self.app.clone();
            let _ = self.app.run_on_main_thread(move || {
                for label in labels {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.hide();
                    }
                }
            });
        }
    }

    fn hide_popup_window(&self, instance_uid: &str, window_uid: &str, menu_uid: &str) {
        let label = popup_label(instance_uid, window_uid, menu_uid);
        self.surfaces.mark_hidden(&label);
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.hide();
            }
        });
    }

    fn handle_sync_outcome(&self, outcome: crate::session::SyncOutcome) {
        let display = self.display_panels.load(Ordering::Relaxed);
        if !display {
            return;
        }

        let instance_uid = outcome.instance_uid;
        let mut labels_to_hide = Vec::new();

        // 1. Check removed windows
        for window_uid in &outcome.removed_window_uids {
            let menu_prefix = surface_prefix("menu", &instance_uid, window_uid);
            let popup_prefix = surface_prefix("popup", &instance_uid, window_uid);
            for (label, _) in self.app.webview_windows() {
                if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                    labels_to_hide.push(label);
                }
            }
        }

        // 2. For each panel, calculate diffs
        let mut sync_items = Vec::new();
        for panel in &outcome.panels {
            let desired = panel
                .menus
                .iter()
                .map(|m| menu_label(&instance_uid, &panel.window.uid, &m.uid))
                .collect::<HashSet<_>>();

            let prefix = surface_prefix("menu", &instance_uid, &panel.window.uid);
            for (label, _) in self.app.webview_windows() {
                if label.starts_with(&prefix) && !desired.contains(&label) {
                    labels_to_hide.push(label);
                }
            }

            for menu in &panel.menus {
                let label = menu_label(&instance_uid, &panel.window.uid, &menu.uid);
                let target_pos = menu_position(&panel.window, &menu.placement);
                let is_customizing = self.surfaces.is_customizing(&label);
                let geometry_changed = self.surfaces.update_geometry(
                    &label,
                    target_pos.x,
                    target_pos.y,
                    menu.placement.width,
                    menu.placement.height,
                    panel.always_on_top,
                );
                let url = format!(
                    "index.html?surface=menu&instanceUid={}&windowUid={}&menuUid={}",
                    urlencoding::encode(&instance_uid),
                    urlencoding::encode(&panel.window.uid),
                    urlencoding::encode(&menu.uid),
                );

                sync_items.push(MenuSyncItem {
                    label,
                    url,
                    target_pos,
                    placement: menu.placement.clone(),
                    always_on_top: panel.always_on_top,
                    is_minimized: panel.window.state == BrowserWindowState::Minimized,
                    is_customizing,
                    geometry_changed,
                    menu: menu.clone(),
                });
            }
        }

        for label in &labels_to_hide {
            self.surfaces.mark_hidden(label);
        }

        let app = self.app.clone();
        let surfaces = self.surfaces.clone();

        // 3. Dispatch batch to UI Thread (Main Thread)
        let _ = self.app.run_on_main_thread(move || {
            // Hide stale windows
            for label in labels_to_hide {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.hide();
                }
            }

            // Sync/Create menu windows
            for item in sync_items {
                let is_new = app.get_webview_window(&item.label).is_none();
                let window = match app.get_webview_window(&item.label) {
                    Some(w) => w,
                    None => {
                        let built = WebviewWindowBuilder::new(
                            &app,
                            &item.label,
                            WebviewUrl::App(item.url.into()),
                        )
                        .title("BrowseRail")
                        .inner_size(item.placement.width, item.placement.height)
                        .position(item.target_pos.x, item.target_pos.y)
                        .decorations(false)
                        .focusable(false)
                        .resizable(false)
                        .shadow(false)
                        .skip_taskbar(true)
                        .transparent(true)
                        .always_on_top(item.always_on_top)
                        .visible(!item.is_minimized)
                        .build();

                        match built {
                            Ok(w) => w,
                            Err(e) => {
                                eprintln!("[BrowseRail] Failed to build menu window {}: {e}", item.label);
                                continue;
                            }
                        }
                    }
                };

                if is_new || item.geometry_changed {
                    let _ = window.set_always_on_top(item.always_on_top);
                    let _ = window.set_ignore_cursor_events(false);
                    if !item.is_customizing {
                        let _ = window.set_size(LogicalSize::new(
                            item.placement.width,
                            item.placement.height,
                        ));
                        let _ = window.set_position(item.target_pos);
                    }
                }

                let actual_visible = window.is_visible().unwrap_or(false);
                if item.is_minimized {
                    if actual_visible {
                        let _ = window.hide();
                    }
                    surfaces.mark_hidden(&item.label);
                } else {
                    if is_new || !actual_visible {
                        let _ = window.show();
                        let _ = window.set_always_on_top(item.always_on_top);
                    }
                    surfaces.mark_visible(&item.label);
                }

                let _ = window.emit_to(&item.label, "menu-state", &item.menu);
            }
        });
    }

    fn check_update_tray(&mut self) {
        let server_text = self.format_server_status();
        let client_text = self.format_client_status();
        let surfaces_text = self.format_surfaces_status();
        let tooltip = self.format_tray_tooltip();
        let display_panels = self.display_panels.load(Ordering::Relaxed);

        let next = TrayStateSnapshot {
            server_text,
            client_text,
            surfaces_text,
            tooltip,
            display_panels,
        };

        if let Some(ref current) = self.last_tray {
            if current.server_text == next.server_text
                && current.client_text == next.client_text
                && current.surfaces_text == next.surfaces_text
                && current.tooltip == next.tooltip
                && current.display_panels == next.display_panels
            {
                return;
            }
        }

        self.last_tray = Some(next.clone());
        let app = self.app.clone();
        let tray_holder = self.tray_holder.clone();

        let _ = self.app.run_on_main_thread(move || {
            if let Ok(guard) = tray_holder.0.lock() {
                if let Some(ref items) = *guard {
                    let _ = items.server_item.set_text(&next.server_text);
                    let _ = items.client_item.set_text(&next.client_text);
                    let _ = items.surfaces_item.set_text(&next.surfaces_text);
                    let _ = items.display_panels_item.set_checked(next.display_panels);
                }
            }
            if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
                let _ = tray.set_tooltip(Some(&next.tooltip));
            }
        });
    }

    fn format_server_status(&self) -> String {
        let status = self.socket.status();
        if let Some(error) = status.error {
            format!("! Listener: Error ({error})")
        } else if status.listening {
            format!("● Listener: 127.0.0.1:{}", status.port)
        } else {
            "○ Listener: Stopped".to_string()
        }
    }

    fn format_client_status(&self) -> String {
        let active = self.registry.active_instances();
        if active.is_empty() {
            "○ Extension: Disconnected".to_string()
        } else {
            format!("● Extension: Connected ({})", active.join(", "))
        }
    }

    fn format_surfaces_status(&self) -> String {
        let (visible, customizing, hidden) = self.surfaces.summary();
        if customizing > 0 {
            format!("● Menus: {visible} visible, {customizing} customizing")
        } else if visible > 0 {
            format!("● Menus: {visible} visible")
        } else if hidden > 0 {
            format!("○ Menus: {hidden} hidden (ready)")
        } else {
            "○ Menus: None".to_string()
        }
    }

    fn format_tray_tooltip(&self) -> String {
        let server_text = match self.socket.state_machine.current() {
            crate::state_machine::ServerState::Listening { port } => format!(":{port}"),
            crate::state_machine::ServerState::Failed { .. } => "Error".to_string(),
            crate::state_machine::ServerState::Unbound => "Stopped".to_string(),
        };
        let active = self.registry.active_instances();
        let client_text = if active.is_empty() {
            "Ext: Disconnected"
        } else {
            "Ext: Connected"
        };
        let (visible, customizing, _) = self.surfaces.summary();
        let panels_text = if customizing > 0 {
            format!(" ({visible} menus, customizing)")
        } else if visible > 0 {
            format!(" ({visible} menus)")
        } else {
            String::new()
        };
        format!("BrowseRail [{server_text}] — {client_text}{panels_text}")
    }
}
