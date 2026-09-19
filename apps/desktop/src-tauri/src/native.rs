use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use uuid::Uuid;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::WindowsAndMessaging::{
    EVENT_SYSTEM_FOREGROUND, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};
use windows::core::PWSTR;

use crate::panel::{
    PopupRegistry, PopupRequest, SurfaceRegistry, instance_surface_prefix, menu_label,
    popup_label, set_window_always_on_top, set_window_no_activate, set_window_owner,
    set_window_visible_without_activation, surface_prefix,
};
use crate::protocol::{
    AttachmentMode, BrowserInstance, MenuAnchor, MenuPlacement, MenuSnapshot,
    PanelSnapshot, ServerMessage,
};
use crate::session::SessionRegistry;
use crate::socket::SocketServer;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrayStateSnapshot {
    pub server_text: String,
    pub extension_lines: Vec<String>,
    pub surfaces_text: String,
    pub tooltip: String,
    pub display_panels: bool,
    pub lock_editing: bool,
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
        attachment_mode: crate::protocol::AttachmentMode,
        panels: Vec<PanelSnapshot>,
    },
    BeginWindowPairing {
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
    },
    ConfirmWindowPairing {
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
    },
    ExpireWindowPairing {
        request_uid: String,
    },
    RebuildInstanceSurfaces {
        instance_uid: String,
        request_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
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
        offset_x: Option<f64>,
        offset_y: Option<f64>,
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
    ToggleLockEditing,
    RefreshWindowLevels,
    UpdateTray,
}

struct MenuSyncItem {
    label: String,
    url: String,
    geometry: crate::protocol::ComputedMenuGeometry,
    always_on_top: bool,
    owner_hwnd: Option<isize>,
    should_be_visible: bool,
    is_customizing: bool,
    geometry_changed: bool,
    menu: MenuSnapshot,
}

struct PendingWindowPairing {
    connection_uid: Uuid,
    instance_uid: String,
    window_uid: String,
    hwnd: isize,
    outgoing: UnboundedSender<ServerMessage>,
}

pub struct NativeReactor {
    app: AppHandle,
    display_panels: Arc<AtomicBool>,
    lock_editing: Arc<AtomicBool>,
    popups: Arc<PopupRegistry>,
    registry: Arc<SessionRegistry>,
    socket: Arc<SocketServer>,
    surfaces: Arc<SurfaceRegistry>,
    native_sender: UnboundedSender<NativeCommand>,
    browser_window_handles: Arc<Mutex<HashMap<(String, String), isize>>>,
    window_levels: Arc<Mutex<HashMap<String, bool>>>,
    window_owners: Arc<Mutex<HashMap<String, isize>>>,
    pending_window_pairings: HashMap<String, PendingWindowPairing>,
    last_tray: Option<TrayStateSnapshot>,
}

static FOREGROUND_EVENT_SENDER: OnceLock<UnboundedSender<NativeCommand>> = OnceLock::new();
static FOREGROUND_EVENT_HOOK: OnceLock<isize> = OnceLock::new();

unsafe extern "system" fn foreground_event_callback(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _object_id: i32,
    _child_id: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if let Some(sender) = FOREGROUND_EVENT_SENDER.get() {
        let _ = sender.send(NativeCommand::RefreshWindowLevels);
    }
}

fn install_foreground_event_hook(app: &AppHandle, sender: UnboundedSender<NativeCommand>) {
    let _ = FOREGROUND_EVENT_SENDER.set(sender);
    let _ = app.run_on_main_thread(|| {
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(foreground_event_callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };
        if hook.0.is_null() {
            crate::debug::log("Native:Hook", "Failed to install foreground window event hook");
        } else {
            crate::debug::log("Native:Hook", format!("Installed foreground window event hook: {:?}", hook.0));
            let _ = FOREGROUND_EVENT_HOOK.set(hook.0 as isize);
        }
    });
}

fn foreground_browser_window() -> Option<(isize, &'static str)> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let browser = foreground_browser_kind(hwnd)?;
    Some((hwnd.0 as isize, browser))
}

fn foreground_browser_kind(hwnd: HWND) -> Option<&'static str> {
    let mut process_id = 0;
    if unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) } == 0 {
        return None;
    }

    let process =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
    let mut path = [0_u16; 1024];
    let mut length = path.len() as u32;
    let query_result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut length,
        )
    };
    let _ = unsafe { CloseHandle(process) };
    query_result.ok()?;

    let executable = String::from_utf16_lossy(&path[..length as usize])
        .rsplit(['\\', '/'])
        .next()?
        .to_ascii_lowercase();
    let kind = match executable.as_str() {
        "brave.exe" => Some("brave"),
        "chrome.exe" | "chromium.exe" | "thorium.exe" => Some("chrome"),
        "msedge.exe" => Some("edge"),
        "firefox.exe" | "floorp.exe" | "librewolf.exe" | "waterfox.exe" => Some("firefox"),
        "opera.exe" | "opera_gx.exe" => Some("opera"),
        "vivaldi.exe" => Some("vivaldi"),
        _ => None,
    };
    if kind.is_none() {
        crate::debug::log(
            "Native:FG",
            format!("Foreground exe '{executable}' not matched to known browser (PID {process_id}, HWND {hwnd:?})"),
        );
    }
    kind
}

fn is_valid_window(hwnd: isize) -> bool {
    unsafe { IsWindow(Some(HWND(hwnd as *mut core::ffi::c_void))).as_bool() }
}

impl NativeReactor {
    pub fn start(
        app: AppHandle,
        display_panels: Arc<AtomicBool>,
        lock_editing: Arc<AtomicBool>,
        popups: Arc<PopupRegistry>,
        registry: Arc<SessionRegistry>,
        socket: Arc<SocketServer>,
        surfaces: Arc<SurfaceRegistry>,
    ) -> UnboundedSender<NativeCommand> {
        let (sender, receiver) = unbounded_channel::<NativeCommand>();
        let mut reactor = Self {
            app,
            display_panels,
            lock_editing,
            popups,
            registry,
            socket,
            surfaces,
            native_sender: sender.clone(),
            browser_window_handles: Arc::new(Mutex::new(HashMap::new())),
            window_levels: Arc::new(Mutex::new(HashMap::new())),
            window_owners: Arc::new(Mutex::new(HashMap::new())),
            pending_window_pairings: HashMap::new(),
            last_tray: None,
        };

        let debug_registry = reactor.registry.clone();
        let debug_handles = reactor.browser_window_handles.clone();
        let debug_levels = reactor.window_levels.clone();
        let debug_owners = reactor.window_owners.clone();
        let debug_surfaces = reactor.surfaces.clone();
        crate::debug::register_state_provider(move || {
            let active_instances = debug_registry.active_instances();
            let paired_windows = debug_handles
                .lock()
                .map(|h| {
                    h.iter()
                        .map(|((inst, win), hwnd)| crate::debug::PairedWindowInfo {
                            instance_uid: inst.clone(),
                            window_uid: win.clone(),
                            hwnd: *hwnd,
                        })
                        .collect()
                })
                .unwrap_or_default();
            let window_levels = debug_levels
                .lock()
                .map(|l| l.clone())
                .unwrap_or_default();
            let window_owners = debug_owners
                .lock()
                .map(|o| o.clone())
                .unwrap_or_default();
            let visible_surfaces = debug_surfaces.visible_labels();
            crate::debug::DebugStateSummary {
                active_instances,
                paired_windows,
                window_levels,
                window_owners,
                visible_surfaces,
            }
        });

        install_foreground_event_hook(&reactor.app, sender.clone());

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
                    self.registry
                        .register(connection_uid, instance, outgoing.clone());
                    let _ = outgoing.send(ServerMessage::Ready {
                        protocol_version: crate::protocol::PROTOCOL_VERSION,
                    });
                    self.check_update_tray();
                }
                NativeCommand::ClientDisconnected { connection_uid } => {
                    self.pending_window_pairings
                        .retain(|_, pairing| pairing.connection_uid != connection_uid);
                    if let Some((instance_uid, window_uids)) =
                        self.registry.disconnect(connection_uid)
                    {
                        if let Ok(mut handles) = self.browser_window_handles.lock() {
                            handles.retain(|(stored_instance_uid, _), _| {
                                stored_instance_uid != &instance_uid
                            });
                        }
                        self.hide_instance_windows(&instance_uid, &window_uids);
                        self.check_update_tray();
                    }
                }
                NativeCommand::SyncPanels {
                    connection_uid,
                    revision,
                    attachment_mode,
                    panels,
                } => {
                    if let Ok(Some(outcome)) =
                        self.registry
                            .sync(connection_uid, revision, attachment_mode, panels)
                    {
                        self.handle_sync_outcome(outcome);
                        self.refresh_window_levels();
                        self.check_update_tray();
                    }
                }
                NativeCommand::BeginWindowPairing {
                    connection_uid,
                    instance_uid,
                    request_uid,
                    window_uid,
                    outgoing,
                } => {
                    self.begin_window_pairing(
                        connection_uid,
                        instance_uid,
                        request_uid,
                        window_uid,
                        outgoing,
                    );
                }
                NativeCommand::ConfirmWindowPairing {
                    connection_uid,
                    instance_uid,
                    request_uid,
                    window_uid,
                    outgoing,
                } => {
                    self.confirm_window_pairing(
                        connection_uid,
                        instance_uid,
                        request_uid,
                        window_uid,
                        outgoing,
                    );
                }
                NativeCommand::ExpireWindowPairing { request_uid } => {
                    if let Some(pairing) = self.pending_window_pairings.remove(&request_uid) {
                        let _ = pairing.outgoing.send(ServerMessage::PairWindowResult {
                            request_uid,
                            window_uid: pairing.window_uid,
                            ok: false,
                        });
                    }
                }
                NativeCommand::RebuildInstanceSurfaces {
                    instance_uid,
                    request_uid,
                    outgoing,
                } => {
                    self.rebuild_instance_surfaces(instance_uid, request_uid, outgoing);
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
                    ..
                } => {
                    let app = self.app.clone();
                    let _ = self.app.run_on_main_thread(move || {
                        let label = crate::panel::menu_label(&instance_uid, &window_uid, &menu_uid);
                        if let Some(window) = app.get_webview_window(&label) {
                            // Only down/right expansion: the window origin never moves, it
                            // only grows. set_size keeps existing pixels and adds new area —
                            // no origin move, no framebuffer shift, no flicker.
                            let _ = window.set_size(LogicalSize::new(width, height));
                        }
                    });
                }
                NativeCommand::SchedulePopupClose {
                    instance_uid,
                    window_uid,
                    menu_uid,
                } => {
                    if let Ok(generation) =
                        self.popups
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
                    let _ = self
                        .registry
                        .update_menu_placement(&instance_uid, menu_uid, placement);
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
                    let mut settings = crate::settings::load(&self.app).unwrap_or_default();
                    settings.display_panels = next;
                    settings.listener_port = self.socket.port();
                    let _ = crate::settings::save(&self.app, &settings);

                    for (instance_uid, attachment_mode, panels) in self.registry.panel_snapshots() {
                        if next {
                            self.handle_sync_outcome(crate::session::SyncOutcome {
                                instance_uid,
                                attachment_mode,
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
                    self.refresh_window_levels();
                    self.check_update_tray();
                }
                NativeCommand::ToggleLockEditing => {
                    let next = !self.lock_editing.load(Ordering::Relaxed);
                    self.lock_editing.store(next, Ordering::Relaxed);
                    let mut settings = crate::settings::load(&self.app).unwrap_or_default();
                    settings.lock_editing = next;
                    settings.listener_port = self.socket.port();
                    let _ = crate::settings::save(&self.app, &settings);
                    // Tell every menu webview so it can enable/disable right-click customize live.
                    let _ = self.app.emit("editing-lock-changed", next);
                    self.check_update_tray();
                }
                NativeCommand::RefreshWindowLevels => {
                    self.refresh_window_levels();
                }
                NativeCommand::UpdateTray => {
                    self.check_update_tray();
                }
            }
        }
    }

    fn begin_window_pairing(
        &mut self,
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
    ) {
        let fg_opt = foreground_browser_window();
        crate::debug::log(
            "Pairing:Begin",
            format!("inst={instance_uid}, req={request_uid}, win={window_uid}, fg={fg_opt:?}"),
        );
        let Some((foreground_hwnd, foreground_browser)) = fg_opt else {
            crate::debug::log("Pairing:Begin", "Failed: foreground_browser_window() is None");
            let _ = outgoing.send(ServerMessage::PairWindowResult {
                request_uid,
                window_uid,
                ok: false,
            });
            return;
        };
        let reported_browser = self.registry.browser_kind(&instance_uid);
        let browser_matches = reported_browser
            .as_deref()
            .is_some_and(|browser| browser_kinds_match(Some(browser), foreground_browser));
        let has_panel = self.registry.panel(&instance_uid, &window_uid).is_some();
        crate::debug::log(
            "Pairing:Begin",
            format!(
                "reported_browser={reported_browser:?}, fg_browser={foreground_browser}, match={browser_matches}, has_panel={has_panel}"
            ),
        );
        if !browser_matches || !has_panel {
            crate::debug::log("Pairing:Begin", "Failed: browser mismatch or panel not in registry");
            let _ = outgoing.send(ServerMessage::PairWindowResult {
                request_uid,
                window_uid,
                ok: false,
            });
            return;
        }

        self.pending_window_pairings.insert(
            request_uid.clone(),
            PendingWindowPairing {
                connection_uid,
                instance_uid,
                window_uid: window_uid.clone(),
                hwnd: foreground_hwnd,
                outgoing: outgoing.clone(),
            },
        );
        crate::debug::log(
            "Pairing:Begin",
            format!("Sending VerifyWindowPairing: req={request_uid}, win={window_uid}"),
        );
        let _ = outgoing.send(ServerMessage::VerifyWindowPairing {
            request_uid: request_uid.clone(),
            window_uid,
        });
        let sender = self.native_sender.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let _ = sender.send(NativeCommand::ExpireWindowPairing { request_uid });
        });
    }

    fn confirm_window_pairing(
        &mut self,
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
    ) {
        let Some(pairing) = self.pending_window_pairings.remove(&request_uid) else {
            crate::debug::log(
                "Pairing:Confirm",
                format!("Failed: pending pairing for req={request_uid} not found or expired"),
            );
            let _ = outgoing.send(ServerMessage::PairWindowResult {
                request_uid,
                window_uid,
                ok: false,
            });
            return;
        };
        let fg_current = foreground_browser_window();
        let foreground_matches =
            fg_current.is_some_and(|(hwnd, _)| hwnd == pairing.hwnd);
        let request_matches = pairing.connection_uid == connection_uid
            && pairing.instance_uid == instance_uid
            && pairing.window_uid == window_uid;
        let identity = (instance_uid.clone(), window_uid.clone());
        let binding_available = self
            .browser_window_handles
            .lock()
            .map(|handles| {
                handles
                    .get(&identity)
                    .is_none_or(|existing| *existing == pairing.hwnd)
                    && handles.iter().all(|(other_identity, hwnd)| {
                        other_identity == &identity || *hwnd != pairing.hwnd
                    })
            })
            .unwrap_or(false);
        let ok = foreground_matches && request_matches && binding_available;
        crate::debug::log(
            "Pairing:Confirm",
            format!(
                "req={request_uid}, win={window_uid}, fg_now={fg_current:?}, paired_hwnd={}, fg_match={foreground_matches}, req_match={request_matches}, binding_avail={binding_available} => ok={ok}",
                pairing.hwnd
            ),
        );

        if ok {
            if let Ok(mut handles) = self.browser_window_handles.lock() {
                handles.insert(identity, pairing.hwnd);
            }
            if let Some((attachment_mode, panel)) =
                self.registry.panel_context(&instance_uid, &window_uid)
            {
                crate::debug::log(
                    "Pairing:Confirm",
                    format!("Triggering sync_outcome for window {window_uid} (mode={attachment_mode:?})"),
                );
                self.handle_sync_outcome(crate::session::SyncOutcome {
                    instance_uid: instance_uid.clone(),
                    attachment_mode,
                    panels: vec![panel],
                    removed_window_uids: Vec::new(),
                });
                self.refresh_window_levels();
            } else {
                crate::debug::log(
                    "Pairing:Confirm",
                    format!("Warning: panel_context not found for window {window_uid}"),
                );
            }
        }

        let _ = pairing.outgoing.send(ServerMessage::PairWindowResult {
            request_uid,
            window_uid,
            ok,
        });
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
                        let _ = set_window_visible_without_activation(&window, false);
                    }
                }
            });
        }
    }

    fn rebuild_instance_surfaces(
        &mut self,
        instance_uid: String,
        request_uid: String,
        outgoing: UnboundedSender<ServerMessage>,
    ) {
        self.pending_window_pairings
            .retain(|_, pairing| pairing.instance_uid != instance_uid);
        let menu_prefix = instance_surface_prefix("menu", &instance_uid);
        let popup_prefix = instance_surface_prefix("popup", &instance_uid);
        let mut labels = self
            .app
            .webview_windows()
            .into_keys()
            .filter(|label| label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix))
            .collect::<Vec<_>>();
        labels.sort_by_key(|label| !label.starts_with(&popup_prefix));

        self.surfaces.remove_labels(&labels);
        self.popups.remove_instance(&instance_uid);
        if let Ok(mut handles) = self.browser_window_handles.lock() {
            handles.retain(|(stored_instance_uid, _), hwnd| {
                stored_instance_uid != &instance_uid || is_valid_window(*hwnd)
            });
        }
        if let Ok(mut levels) = self.window_levels.lock() {
            levels.retain(|label, _| {
                !label.starts_with(&menu_prefix) && !label.starts_with(&popup_prefix)
            });
        }
        if let Ok(mut owners) = self.window_owners.lock() {
            owners.retain(|label, _| {
                !label.starts_with(&menu_prefix) && !label.starts_with(&popup_prefix)
            });
        }

        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            for label in labels {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = crate::panel::safely_destroy_window(&window);
                }
            }
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(75)).await;
                let _ = outgoing.send(ServerMessage::ResyncComplete { request_uid });
            });
        });
    }

    fn hide_popup_window(&self, instance_uid: &str, window_uid: &str, menu_uid: &str) {
        let label = popup_label(instance_uid, window_uid, menu_uid);
        self.surfaces.mark_hidden(&label);
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = set_window_visible_without_activation(&window, false);
            }
        });
    }

    fn handle_sync_outcome(&self, outcome: crate::session::SyncOutcome) {
        let display = self.display_panels.load(Ordering::Relaxed);
        let instance_uid = outcome.instance_uid;
        let attachment_mode = outcome.attachment_mode;
        let foreground_hwnd = unsafe { GetForegroundWindow().0 as isize };
        let mut labels_to_destroy = Vec::new();

        crate::debug::log(
            "Native:SyncOutcome",
            format!(
                "outcome: inst={instance_uid}, panels={}, display={display}, mode={attachment_mode:?}, fg_hwnd={foreground_hwnd}",
                outcome.panels.len()
            ),
        );

        for window_uid in &outcome.removed_window_uids {
            let owner_hwnd = self.browser_window_handles.lock().ok().and_then(|handles| {
                handles.get(&(instance_uid.clone(), window_uid.clone())).copied()
            });
            let is_alive = owner_hwnd.is_some_and(is_valid_window);

            let menu_prefix = surface_prefix("menu", &instance_uid, window_uid);
            let popup_prefix = surface_prefix("popup", &instance_uid, window_uid);

            if !is_alive {
                for (label, _) in self.app.webview_windows() {
                    if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                        labels_to_destroy.push(label);
                    }
                }
                self.popups.remove_window(&instance_uid, window_uid);
                if let Ok(mut handles) = self.browser_window_handles.lock() {
                    handles.remove(&(instance_uid.clone(), window_uid.clone()));
                }
            } else {
                for (label, _) in self.app.webview_windows() {
                    if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                        self.surfaces.mark_hidden(&label);
                    }
                }
            }
        }

        if let Ok(mut handles) = self.browser_window_handles.lock() {
            let dead_identities = handles
                .iter()
                .filter(|(_, hwnd)| !is_valid_window(**hwnd))
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in dead_identities {
                handles.remove(&id);
                let menu_prefix = surface_prefix("menu", &id.0, &id.1);
                let popup_prefix = surface_prefix("popup", &id.0, &id.1);
                for (label, _) in self.app.webview_windows() {
                    if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                        labels_to_destroy.push(label);
                    }
                }
                self.popups.remove_window(&id.0, &id.1);
            }
        }

        let mut sync_items = Vec::new();
        for panel in &outcome.panels {
            let owner_hwnd = self.browser_window_handles.lock().ok().and_then(|handles| {
                handles
                    .get(&(instance_uid.clone(), panel.window.uid.clone()))
                    .copied()
            });
            crate::debug::log(
                "Native:SyncOutcome",
                format!("panel win={}: owner_hwnd={owner_hwnd:?}", panel.window.uid),
            );
            let Some(owner_hwnd) = owner_hwnd else {
                crate::debug::log(
                    "Native:SyncOutcome",
                    format!("panel win={}: skipped because owner_hwnd is None", panel.window.uid),
                );
                continue;
            };
            let desired = panel
                .menus
                .iter()
                .filter(|m| m.enabled != Some(false))
                .map(|m| menu_label(&instance_uid, &panel.window.uid, &m.uid))
                .collect::<HashSet<_>>();

            let prefix = surface_prefix("menu", &instance_uid, &panel.window.uid);
            for (label, _) in self.app.webview_windows() {
                if label.starts_with(&prefix) && !desired.contains(&label) {
                    labels_to_destroy.push(label);
                }
            }

            for menu in panel.menus.iter().filter(|m| m.enabled != Some(false)) {
                let label = menu_label(&instance_uid, &panel.window.uid, &menu.uid);
                let geometry = crate::protocol::compute_menu_geometry(&panel.window, menu);
                let is_customizing = self.surfaces.is_customizing(&label);
                let effective_always_on_top =
                    menu.on_top_mode == crate::protocol::OnTopMode::AlwaysOnTop;
                let geometry_changed = self.surfaces.update_geometry(
                    &label,
                    geometry.x,
                    geometry.y,
                    geometry.width,
                    geometry.height,
                    effective_always_on_top,
                );
                let url = format!(
                    "index.html?surface=menu&instanceUid={}&windowUid={}&menuUid={}",
                    urlencoding::encode(&instance_uid),
                    urlencoding::encode(&panel.window.uid),
                    urlencoding::encode(&menu.uid),
                );

                let owner = Some(owner_hwnd);

                let is_focused = match menu.attachment_mode {
                    AttachmentMode::None => false,
                    AttachmentMode::All => true,
                    AttachmentMode::LastFocused => panel.window.focused,
                };
                let should_be_visible = display && is_focused;

                sync_items.push(MenuSyncItem {
                    label,
                    url,
                    geometry,
                    always_on_top: effective_always_on_top,
                    owner_hwnd: owner,
                    should_be_visible,
                    is_customizing,
                    geometry_changed,
                    menu: menu.clone(),
                });
            }
        }

        labels_to_destroy.sort();
        labels_to_destroy.dedup();
        self.surfaces.remove_labels(&labels_to_destroy);
        if let Ok(mut levels) = self.window_levels.lock() {
            for label in &labels_to_destroy {
                levels.remove(label);
            }
        }
        if let Ok(mut owners) = self.window_owners.lock() {
            for label in &labels_to_destroy {
                owners.remove(label);
            }
        }

        let app = self.app.clone();
        let surfaces = self.surfaces.clone();
        let window_levels = self.window_levels.clone();
        let window_owners = self.window_owners.clone();

        let _ = self.app.run_on_main_thread(move || {
            for label in labels_to_destroy {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = crate::panel::safely_destroy_window(&window);
                }
            }

            for item in sync_items {
                let is_new = app.get_webview_window(&item.label).is_none();
                if is_new && !item.should_be_visible {
                    continue;
                }
                let window = match app.get_webview_window(&item.label) {
                    Some(w) => w,
                    None => {
                        let built = WebviewWindowBuilder::new(
                            &app,
                            &item.label,
                            WebviewUrl::App(item.url.into()),
                        )
                        .title("BrowseRail")
                        .inner_size(item.geometry.width, item.geometry.height)
                        .position(item.geometry.x, item.geometry.y)
                        .decorations(false)
                        .focused(false)
                        .focusable(false)
                        .resizable(false)
                        .shadow(false)
                        .skip_taskbar(true)
                        .transparent(true)
                        .always_on_top(item.always_on_top)
                        .visible(false)
                        .build();

                        match built {
                            Ok(w) => w,
                            Err(e) => {
                                crate::debug::log(
                                    "Native:Window",
                                    format!("Failed to build menu window {}: {e}", item.label),
                                );
                                continue;
                            }
                        }
                    }
                };

                let Some(owner_hwnd) = item.owner_hwnd else {
                    continue;
                };
                let _ = set_window_no_activate(&window);
                let current_owner = window_owners
                    .lock()
                    .ok()
                    .and_then(|owners| owners.get(&item.label).copied());
                let owner_ready = if current_owner == Some(owner_hwnd) {
                    true
                } else if current_owner.is_none_or(|current| !is_valid_window(current)) {
                    match set_window_owner(&window, owner_hwnd) {
                        Ok(_) => {
                            if let Ok(mut owners) = window_owners.lock() {
                                owners.insert(item.label.clone(), owner_hwnd);
                            }
                            crate::debug::log(
                                "Native:Window",
                                format!("{}: set_window_owner to {owner_hwnd} succeeded", item.label),
                            );
                            true
                        }
                        Err(err) => {
                            crate::debug::log(
                                "Native:Window",
                                format!("{}: set_window_owner to {owner_hwnd} FAILED: {err}", item.label),
                            );
                            false
                        }
                    }
                } else {
                    false
                };
                if !owner_ready {
                    crate::debug::log(
                        "Native:Window",
                        format!("{}: owner not ready, skipping", item.label),
                    );
                    continue;
                }

                let current_level = window_levels
                    .lock()
                    .ok()
                    .and_then(|levels| levels.get(&item.label).copied());
                if is_new {
                    if let Ok(mut levels) = window_levels.lock() {
                        levels.insert(item.label.clone(), item.always_on_top);
                    }
                } else if current_level != Some(item.always_on_top)
                    && set_window_always_on_top(&window, item.always_on_top).is_ok()
                {
                    if let Ok(mut levels) = window_levels.lock() {
                        levels.insert(item.label.clone(), item.always_on_top);
                    }
                }
                if is_new || item.geometry_changed {
                    let _ = window.set_ignore_cursor_events(false);
                    if !item.is_customizing {
                        let _ = window.set_size(LogicalSize::new(
                            item.geometry.width,
                            item.geometry.height,
                        ));
                        let _ = window.set_position(tauri::LogicalPosition::new(
                            item.geometry.x,
                            item.geometry.y,
                        ));
                    }
                }

                if item.should_be_visible && !surfaces.is_visible(&item.label) {
                    let res = set_window_visible_without_activation(&window, true);
                    crate::debug::log(
                        "Native:Window",
                        format!("{}: show window res={res:?}", item.label),
                    );
                    surfaces.mark_visible(&item.label);
                } else if !item.should_be_visible && surfaces.is_visible(&item.label) {
                    let res = set_window_visible_without_activation(&window, false);
                    crate::debug::log(
                        "Native:Window",
                        format!("{}: hide window res={res:?}", item.label),
                    );
                    surfaces.mark_hidden(&item.label);
                }

                let _ = window.emit_to(&item.label, "menu-state", &item.menu);
            }
        });
    }

    fn refresh_window_levels(&self) {
        let display = self.display_panels.load(Ordering::Relaxed);
        let foreground_hwnd = unsafe { GetForegroundWindow().0 as isize };
        let browser_window_handles = self
            .browser_window_handles
            .lock()
            .map(|handles| handles.clone())
            .unwrap_or_default();
        let mut desired_levels = HashMap::new();
        let mut visibility_changes = Vec::new();
        let mut popup_labels_to_hide = Vec::new();
        let mut labels_to_destroy = Vec::new();
        if let Ok(mut handles) = self.browser_window_handles.lock() {
            let dead_identities = handles
                .iter()
                .filter(|(_, hwnd)| !is_valid_window(**hwnd))
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in dead_identities {
                handles.remove(&id);
                let menu_prefix = surface_prefix("menu", &id.0, &id.1);
                let popup_prefix = surface_prefix("popup", &id.0, &id.1);
                for (label, _) in self.app.webview_windows() {
                    if label.starts_with(&menu_prefix) || label.starts_with(&popup_prefix) {
                        labels_to_destroy.push(label);
                    }
                }
                self.popups.remove_window(&id.0, &id.1);
            }
        }
        if !labels_to_destroy.is_empty() {
            labels_to_destroy.sort();
            labels_to_destroy.dedup();
            self.surfaces.remove_labels(&labels_to_destroy);
            if let Ok(mut levels) = self.window_levels.lock() {
                for label in &labels_to_destroy {
                    levels.remove(label);
                }
            }
            if let Ok(mut owners) = self.window_owners.lock() {
                for label in &labels_to_destroy {
                    owners.remove(label);
                }
            }
            let app = self.app.clone();
            let _ = self.app.run_on_main_thread(move || {
                for label in labels_to_destroy {
                    if let Some(w) = app.get_webview_window(&label) {
                        let _ = crate::panel::safely_destroy_window(&w);
                    }
                }
            });
        }

        for snapshot in self.registry.instance_panel_snapshots() {
            for panel in snapshot.panels {
                let owner_hwnd = browser_window_handles
                    .get(&(snapshot.instance_uid.clone(), panel.window.uid.clone()))
                    .copied();
                for menu in panel.menus {
                    let always_on_top =
                        menu.on_top_mode == crate::protocol::OnTopMode::AlwaysOnTop;
                    let is_focused = match menu.attachment_mode {
                        AttachmentMode::None => false,
                        AttachmentMode::All => true,
                        AttachmentMode::LastFocused => panel.window.focused,
                    };
                    let should_be_visible = display
                        && owner_hwnd.is_some()
                        && is_focused;
                    let menu_label =
                        menu_label(&snapshot.instance_uid, &panel.window.uid, &menu.uid);
                    let popup_label =
                        popup_label(&snapshot.instance_uid, &panel.window.uid, &menu.uid);
                    desired_levels.insert(menu_label.clone(), always_on_top);
                    desired_levels.insert(popup_label.clone(), always_on_top);
                    if self.surfaces.is_visible(&menu_label) != should_be_visible {
                        visibility_changes.push((menu_label, should_be_visible));
                    }
                    if !should_be_visible && self.surfaces.is_visible(&popup_label) {
                        popup_labels_to_hide.push(popup_label);
                    }
                }
            }
        }

        crate::debug::log(
            "Native:RefreshLevels",
            format!(
                "display={display}, fg={foreground_hwnd}, visibility_changes={:?}",
                visibility_changes
            ),
        );

        let changes = self
            .window_levels
            .lock()
            .map(|levels| {
                desired_levels
                    .into_iter()
                    .filter(|(label, desired)| levels.get(label) != Some(desired))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if changes.is_empty() && visibility_changes.is_empty() && popup_labels_to_hide.is_empty() {
            return;
        }

        let app = self.app.clone();
        let surfaces = self.surfaces.clone();
        let window_levels = self.window_levels.clone();
        let _ = self.app.run_on_main_thread(move || {
            for (label, always_on_top) in changes {
                let Some(window) = app.get_webview_window(&label) else {
                    continue;
                };
                if set_window_always_on_top(&window, always_on_top).is_ok() {
                    if let Ok(mut levels) = window_levels.lock() {
                        levels.insert(label, always_on_top);
                    }
                }
            }

            for (label, should_be_visible) in visibility_changes {
                let Some(window) = app.get_webview_window(&label) else {
                    continue;
                };
                if should_be_visible {
                    let _ = set_window_visible_without_activation(&window, true);
                    surfaces.mark_visible(&label);
                } else {
                    let _ = set_window_visible_without_activation(&window, false);
                    surfaces.mark_hidden(&label);
                }
            }

            for label in popup_labels_to_hide {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = set_window_visible_without_activation(&window, false);
                }
                surfaces.mark_hidden(&label);
            }
        });
    }

    fn check_update_tray(&mut self) {
        let server_text = self.format_server_status();
        let extension_lines = self.format_extension_lines();
        let surfaces_text = self.format_surfaces_status();
        let tooltip = self.format_tray_tooltip();
        let display_panels = self.display_panels.load(Ordering::Relaxed);
        let lock_editing = self.lock_editing.load(Ordering::Relaxed);

        let next = TrayStateSnapshot {
            server_text,
            extension_lines,
            surfaces_text,
            tooltip,
            display_panels,
            lock_editing,
        };

        if self.last_tray.as_ref() == Some(&next) {
            return;
        }

        self.last_tray = Some(next.clone());
        let app = self.app.clone();

        let _ = self.app.run_on_main_thread(move || {
            if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
                if let Ok(menu) = crate::build_tray_menu(&app, &next) {
                    let _ = tray.set_menu(Some(menu));
                }
                let _ = tray.set_tooltip(Some(&next.tooltip));
            }
        });
    }

    fn format_server_status(&self) -> String {
        use crate::i18n::Msg;
        let status = self.socket.status();
        if status.error.is_some() {
            Msg::ListenerError.localized()
        } else if status.listening {
            Msg::ListenerListening { port: status.port }.localized()
        } else {
            Msg::ListenerStopped.localized()
        }
    }

    fn format_extension_lines(&self) -> Vec<String> {
        use crate::i18n::Msg;
        let extensions = self.registry.active_extensions();
        if extensions.is_empty() {
            vec![Msg::ExtensionDisconnected.localized()]
        } else {
            extensions
                .into_iter()
                .map(|ext| {
                    let browser_name = match ext.browser.as_deref() {
                        Some("chrome") => "Chrome",
                        Some("edge") => "Edge",
                        Some("brave") => "Brave",
                        Some("firefox") => "Firefox",
                        Some("opera") => "Opera",
                        Some("vivaldi") => "Vivaldi",
                        Some(b) if !b.is_empty() => b,
                        _ => "Connected",
                    };
                    let label = ext
                        .label
                        .as_deref()
                        .filter(|l| !l.is_empty())
                        .unwrap_or(&ext.instance_uid);
                    Msg::ExtensionConnected {
                        browser: browser_name,
                        label,
                    }
                    .localized()
                })
                .collect()
        }
    }

    fn format_surfaces_status(&self) -> String {
        use crate::i18n::Msg;
        let (visible, customizing, hidden) = self.surfaces.summary();
        if customizing > 0 {
            Msg::MenusVisibleCustomizing {
                visible,
                customizing,
            }
            .localized()
        } else if visible > 0 {
            Msg::MenusVisible { visible }.localized()
        } else if hidden > 0 {
            Msg::MenusHidden { hidden }.localized()
        } else {
            Msg::MenusNone.localized()
        }
    }

    fn format_tray_tooltip(&self) -> String {
        use crate::i18n::Msg;
        let server_text = match self.socket.state_machine.current() {
            crate::state_machine::ServerState::Listening { port } => format!(":{port}"),
            crate::state_machine::ServerState::Failed { .. } => Msg::TooltipServerError.localized(),
            crate::state_machine::ServerState::Unbound => Msg::TooltipServerStopped.localized(),
        };
        let active = self.registry.active_extensions();
        let client_text = if active.is_empty() {
            Msg::TooltipExtDisconnected.localized()
        } else {
            Msg::TooltipExtConnected { count: active.len() }.localized()
        };
        let (visible, customizing, _) = self.surfaces.summary();
        let panels_text = if customizing > 0 {
            Msg::TooltipPanelsCustomizing { visible }.localized()
        } else if visible > 0 {
            Msg::TooltipPanels { visible }.localized()
        } else {
            String::new()
        };
        format!("BrowseRail [{server_text}] — {client_text}{panels_text}")
    }
}

fn browser_kinds_match(reported: Option<&str>, foreground: &str) -> bool {
    reported == Some(foreground)
}
