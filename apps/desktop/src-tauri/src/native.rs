use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use uuid::Uuid;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_OEM_1, VK_OEM_2, VK_OEM_3, VK_OEM_4,
    VK_OEM_5, VK_OEM_6, VK_OEM_7, VK_OEM_COMMA, VK_OEM_MINUS, VK_OEM_PERIOD, VK_OEM_PLUS,
    VK_RETURN, VK_RWIN, VK_SHIFT, VK_SPACE, VK_TAB,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, EVENT_SYSTEM_FOREGROUND, GA_ROOT, GetAncestor, GetForegroundWindow,
    GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO, HHOOK, IsWindow, KBDLLHOOKSTRUCT,
    SetWindowsHookExW, UnhookWindowsHookEx, WH_KEYBOARD_LL, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_KEYDOWN, WM_SYSKEYDOWN,
};
use windows::core::PWSTR;

use crate::panel::{
    PopupPointerAction, PopupPointerSource, PopupRegistry, PopupRequest, SurfaceRegistry,
    free_label, instance_surface_prefix, is_window_always_on_top, menu_label, popup_label,
    set_window_always_on_top, set_window_no_activate, set_window_owner,
    set_window_visible_without_activation, surface_prefix,
};
use crate::protocol::{
    AttachmentMode, BrowserInstance, BrowserWindowSnapshot, MenuAnchor, MenuPlacement, MenuTarget,
    NativeMessage, SyncedMenu, SyncedNativeShortcut,
};
use crate::session::SessionRegistry;
use crate::settings::CollapsedMenu;
use crate::socket::SocketServer;

// A short cancellable handoff window lets pointerleave on one HWND be followed
// by pointerenter on the adjacent popup before logical menu closure becomes final.
const POPUP_CLOSE_DELAY_MS: u64 = 50;
const POPUP_HIDE_DELAY_MS: u64 = 500;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrayStateSnapshot {
    pub server_text: String,
    pub extension_lines: Vec<String>,
    pub surfaces_text: String,
    pub tooltip: String,
    pub display_panels: bool,
    pub enable_shortcuts: bool,
    pub lock_editing: bool,
}

pub enum NativeCommand {
    ClientRegistered {
        connection_uid: Uuid,
        instance: BrowserInstance,
        outgoing: UnboundedSender<NativeMessage>,
    },
    ClientDisconnected {
        connection_uid: Uuid,
    },
    SyncMenus {
        connection_uid: Uuid,
        revision: u64,
        menus: Vec<SyncedMenu>,
        reset_menu_uids: Vec<String>,
        native_shortcuts: Vec<SyncedNativeShortcut>,
    },
    NativeShortcutTriggered {
        key: String,
        foreground_hwnd: isize,
    },
    BeginWindowPairing {
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<NativeMessage>,
    },
    ConfirmWindowPairing {
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<NativeMessage>,
    },
    ExpireWindowPairing {
        request_uid: String,
    },
    RebuildInstanceSurfaces {
        instance_uid: String,
        request_uid: String,
        outgoing: UnboundedSender<NativeMessage>,
    },
    OpenPopup {
        request: PopupRequest,
    },
    ShowPopup {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        request_uid: String,
    },
    SchedulePopupClose {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    BeginPopupClose {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        generation: u64,
    },
    CancelPopupClose {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
    },
    SetPopupPointerInside {
        instance_uid: String,
        window_uid: String,
        menu_uid: String,
        source: PopupPointerSource,
        inside: bool,
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
    ToggleEnableShortcuts,
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
    window_uid: String,
    menu: crate::protocol::SurfaceMenu,
    collapsed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuStateEvent<'a> {
    instance_uid: &'a str,
    window_uid: Option<&'a str>,
    menu: &'a crate::protocol::SurfaceMenu,
    collapsed: bool,
}

struct PendingWindowPairing {
    connection_uid: Uuid,
    instance_uid: String,
    window_uid: String,
    hwnd: isize,
    outgoing: UnboundedSender<NativeMessage>,
}

pub struct NativeReactor {
    app: AppHandle,
    display_panels: Arc<AtomicBool>,
    enable_shortcuts: Arc<AtomicBool>,
    lock_editing: Arc<AtomicBool>,
    popups: Arc<PopupRegistry>,
    registry: Arc<SessionRegistry>,
    socket: Arc<SocketServer>,
    surfaces: Arc<SurfaceRegistry>,
    collapsed_menus: Arc<Mutex<Vec<CollapsedMenu>>>,
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
            crate::debug::log(
                "Native:Hook",
                "Failed to install foreground window event hook",
            );
        } else {
            crate::debug::log(
                "Native:Hook",
                format!("Installed foreground window event hook: {:?}", hook.0),
            );
            let _ = FOREGROUND_EVENT_HOOK.set(hook.0 as isize);
        }
    });
}

static mut KEYBOARD_HOOK: isize = 0;
static mut ACTIVE_NATIVE_SHORTCUTS: *mut HashSet<String> = std::ptr::null_mut();
static mut ACTIVE_PAIRED_HWNDS: *mut HashSet<isize> = std::ptr::null_mut();
static KEYBOARD_EVENT_SENDER: OnceLock<UnboundedSender<NativeCommand>> = OnceLock::new();

fn sync_paired_hwnds(app: &AppHandle, hwnds: HashSet<isize>) {
    let _ = app.run_on_main_thread(move || {
        unsafe {
            if !ACTIVE_PAIRED_HWNDS.is_null() {
                drop(Box::from_raw(ACTIVE_PAIRED_HWNDS));
                ACTIVE_PAIRED_HWNDS = std::ptr::null_mut();
            }
            ACTIVE_PAIRED_HWNDS = Box::into_raw(Box::new(hwnds));
        }
    });
}

fn sync_keyboard_hook(app: &AppHandle, shortcuts: HashSet<String>) {
    let _ = app.run_on_main_thread(move || {
        unsafe {
            if let Some(hook_ptr) = (KEYBOARD_HOOK != 0).then_some(HHOOK(KEYBOARD_HOOK as *mut _)) {
                let _ = UnhookWindowsHookEx(hook_ptr);
                KEYBOARD_HOOK = 0;
            }

            if !ACTIVE_NATIVE_SHORTCUTS.is_null() {
                drop(Box::from_raw(ACTIVE_NATIVE_SHORTCUTS));
                ACTIVE_NATIVE_SHORTCUTS = std::ptr::null_mut();
            }

            if shortcuts.is_empty() {
                return;
            }

            ACTIVE_NATIVE_SHORTCUTS = Box::into_raw(Box::new(shortcuts));

            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(low_level_keyboard_proc),
                None,
                0,
            );
            match hook {
                Ok(h) => {
                    crate::debug::log(
                        "Native:Hook",
                        format!("Installed low-level keyboard hook: {:?}", h.0),
                    );
                    KEYBOARD_HOOK = h.0 as isize;
                }
                Err(e) => {
                    crate::debug::log(
                        "Native:Hook",
                        format!("Failed to install low-level keyboard hook: {e:?}"),
                    );
                }
            }
        }
    });
}

fn is_caret_or_edit_active(hwnd: HWND) -> bool {
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, None) };
    if thread_id == 0 {
        return false;
    }
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetGUIThreadInfo(thread_id, &mut info).is_ok() } {
        if !info.hwndCaret.0.is_null() || (info.flags.0 & 1 != 0) {
            return true;
        }
    }
    false
}

fn format_vk_key(kbd: &KBDLLHOOKSTRUCT) -> Option<String> {
    let vk = kbd.vkCode;
    if vk == VK_CONTROL.0 as u32
        || vk == VK_SHIFT.0 as u32
        || vk == VK_MENU.0 as u32
        || vk == VK_LWIN.0 as u32
        || vk == VK_RWIN.0 as u32
    {
        return None;
    }

    let ctrl = unsafe { (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0 };
    let alt = unsafe { (GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0 } || (kbd.flags.0 & 0x20 != 0);
    let shift = unsafe { (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0 };
    let meta = unsafe { (GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000) != 0 }
        || unsafe { (GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000) != 0 };

    let key_name = match vk {
        0x41..=0x5A => {
            let ch = (b'a' + (vk - 0x41) as u8) as char;
            if ctrl || alt || meta {
                ch.to_ascii_uppercase().to_string()
            } else {
                ch.to_string()
            }
        }
        0x30..=0x39 => {
            let ch = (b'0' + (vk - 0x30) as u8) as char;
            ch.to_string()
        }
        0x70..=0x7B => format!("F{}", vk - 0x70 + 1),
        x if x == VK_SPACE.0 as u32 => "Space".to_string(),
        x if x == VK_RETURN.0 as u32 => "Enter".to_string(),
        x if x == VK_TAB.0 as u32 => "Tab".to_string(),
        0x08 => "Backspace".to_string(),
        0x2E => "Delete".to_string(),
        0x1B => "Escape".to_string(),
        x if x == VK_OEM_1.0 as u32 => ";".to_string(),
        x if x == VK_OEM_PLUS.0 as u32 => "+".to_string(),
        x if x == VK_OEM_COMMA.0 as u32 => ",".to_string(),
        x if x == VK_OEM_MINUS.0 as u32 => "-".to_string(),
        x if x == VK_OEM_PERIOD.0 as u32 => ".".to_string(),
        x if x == VK_OEM_2.0 as u32 => "/".to_string(),
        x if x == VK_OEM_3.0 as u32 => "`".to_string(),
        x if x == VK_OEM_4.0 as u32 => "[".to_string(),
        x if x == VK_OEM_5.0 as u32 => "\\".to_string(),
        x if x == VK_OEM_6.0 as u32 => "]".to_string(),
        x if x == VK_OEM_7.0 as u32 => "'".to_string(),
        _ => return None,
    };

    let mut parts = Vec::new();
    if ctrl {
        parts.push("Ctrl");
    }
    if alt {
        parts.push("Alt");
    }
    if shift {
        parts.push("Shift");
    }
    if meta {
        parts.push("Meta");
    }
    parts.push(&key_name);
    Some(parts.join("+"))
}

unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let fg_hwnd = unsafe { GetForegroundWindow() };
        if !fg_hwnd.0.is_null() {
            let is_paired = unsafe {
                if ACTIVE_PAIRED_HWNDS.is_null() || (*ACTIVE_PAIRED_HWNDS).is_empty() {
                    false
                } else {
                    let raw = fg_hwnd.0 as isize;
                    (*ACTIVE_PAIRED_HWNDS).contains(&raw) || {
                        let root = GetAncestor(fg_hwnd, GA_ROOT);
                        !root.0.is_null() && (*ACTIVE_PAIRED_HWNDS).contains(&(root.0 as isize))
                    }
                }
            };

            if is_paired {
                let kbd = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
                if let Some(key_str) = format_vk_key(kbd) {
                    let lower = key_str.to_ascii_lowercase();
                    let has_match = unsafe {
                        if !ACTIVE_NATIVE_SHORTCUTS.is_null() {
                            (*ACTIVE_NATIVE_SHORTCUTS).contains(&lower)
                        } else {
                            false
                        }
                    };

                    if has_match {
                        let is_typing = is_caret_or_edit_active(fg_hwnd);
                        let is_single_char = !key_str.contains('+') && key_str.chars().count() == 1;
                        if !(is_single_char && is_typing) {
                            if let Some(sender) = KEYBOARD_EVENT_SENDER.get() {
                                let _ = sender.send(NativeCommand::NativeShortcutTriggered {
                                    key: key_str,
                                    foreground_hwnd: fg_hwnd.0 as isize,
                                });
                            }
                            return LRESULT(1);
                        }
                    }
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Resolve where a free surface should sit, in logical screen coordinates.
/// A saved position is used only when it lands inside some monitor's visible
/// work area; otherwise (no saved position, or the old spot is now off-screen)
/// the surface is centered on the lastFocused browser window when its bounds are
/// known, else on the primary monitor.
fn resolve_free_position(
    app: &AppHandle,
    free_pos: Option<(f64, f64)>,
    width: f64,
    height: f64,
    window_bounds: Option<(f64, f64, f64, f64)>,
) -> (f64, f64) {
    let center = || -> (f64, f64) {
        if let Some((bx, by, bw, bh)) = window_bounds {
            return (bx + (bw - width) / 2.0, by + (bh - height) / 2.0);
        }
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let scale = monitor.scale_factor();
            let pos = monitor.position();
            let size = monitor.size();
            let mx = f64::from(pos.x) / scale;
            let my = f64::from(pos.y) / scale;
            let mw = f64::from(size.width) / scale;
            let mh = f64::from(size.height) / scale;
            (mx + (mw - width) / 2.0, my + (mh - height) / 2.0)
        } else {
            (100.0, 100.0)
        }
    };

    let Some((x, y)) = free_pos else {
        return center();
    };

    let on_screen = app
        .available_monitors()
        .map(|monitors| {
            monitors.iter().any(|monitor| {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let ax = f64::from(area.position.x) / scale;
                let ay = f64::from(area.position.y) / scale;
                let aw = f64::from(area.size.width) / scale;
                let ah = f64::from(area.size.height) / scale;
                x >= ax && x < ax + aw && y >= ay && y < ay + ah
            })
        })
        .unwrap_or(false);

    if on_screen { (x, y) } else { center() }
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
            format!(
                "Foreground exe '{executable}' not matched to known browser (PID {process_id}, HWND {hwnd:?})"
            ),
        );
    }
    kind
}

fn is_valid_window(hwnd: isize) -> bool {
    unsafe { IsWindow(Some(HWND(hwnd as *mut core::ffi::c_void))).as_bool() }
}

fn is_menu_collapsed(
    collapsed_menus: &Arc<Mutex<Vec<CollapsedMenu>>>,
    instance_uid: &str,
    menu_uid: &str,
) -> bool {
    collapsed_menus
        .lock()
        .map(|menus| {
            menus
                .iter()
                .any(|item| item.instance_uid == instance_uid && item.menu_uid == menu_uid)
        })
        .unwrap_or(false)
}

impl NativeReactor {
    pub fn start(
        app: AppHandle,
        display_panels: Arc<AtomicBool>,
        enable_shortcuts: Arc<AtomicBool>,
        lock_editing: Arc<AtomicBool>,
        popups: Arc<PopupRegistry>,
        registry: Arc<SessionRegistry>,
        socket: Arc<SocketServer>,
        surfaces: Arc<SurfaceRegistry>,
        collapsed_menus: Arc<Mutex<Vec<CollapsedMenu>>>,
    ) -> UnboundedSender<NativeCommand> {
        let (sender, receiver) = unbounded_channel::<NativeCommand>();
        let mut reactor = Self {
            app,
            display_panels,
            enable_shortcuts,
            lock_editing,
            popups,
            registry,
            socket,
            surfaces,
            collapsed_menus,
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
            let window_levels = debug_levels.lock().map(|l| l.clone()).unwrap_or_default();
            let window_owners = debug_owners.lock().map(|o| o.clone()).unwrap_or_default();
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
        let _ = KEYBOARD_EVENT_SENDER.set(sender.clone());

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
                    let _ = outgoing.send(NativeMessage::Ready {
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
                        if self.enable_shortcuts.load(Ordering::Relaxed) {
                            sync_keyboard_hook(&self.app, self.registry.all_active_shortcut_keys());
                        } else {
                            sync_keyboard_hook(&self.app, HashSet::new());
                        }
                        if let Ok(mut handles) = self.browser_window_handles.lock() {
                            handles.retain(|(stored_instance_uid, _), _| {
                                stored_instance_uid != &instance_uid
                            });
                        }
                        self.sync_active_paired_hwnds();
                        self.hide_instance_windows(&instance_uid, &window_uids);
                        self.hide_instance_free_surfaces(&instance_uid);
                        self.check_update_tray();
                    }
                }
                NativeCommand::SyncMenus {
                    connection_uid,
                    revision,
                    menus,
                    reset_menu_uids,
                    native_shortcuts,
                } => {
                    if let Ok(Some(outcome)) =
                        self.registry
                            .sync(connection_uid, revision, menus, reset_menu_uids, native_shortcuts)
                    {
                        let instance_uid = outcome.instance_uid.clone();
                        if self.enable_shortcuts.load(Ordering::Relaxed) {
                            sync_keyboard_hook(&self.app, self.registry.all_active_shortcut_keys());
                        } else {
                            sync_keyboard_hook(&self.app, HashSet::new());
                        }
                        let synced_menus = outcome.menus.clone();
                        let free_menus = synced_menus
                            .iter()
                            .filter(|synced| synced.is_free())
                            .cloned()
                            .collect::<Vec<_>>();
                        let reset_menu_uids = outcome.reset_menu_uids.clone();
                        // Center a new free surface on the last-focused browser window, falling
                        // back to any browser window and then the primary monitor.
                        let window_bounds = synced_menus
                            .iter()
                            .filter_map(|synced| synced.reference_window())
                            .find(|window| window.focused)
                            .or_else(|| {
                                synced_menus
                                    .iter()
                                    .find_map(|synced| synced.reference_window())
                            })
                            .map(|window| {
                                let b = &window.bounds;
                                (b.x, b.y, b.width, b.height)
                            });
                        self.prune_collapsed_menus(&instance_uid, &synced_menus);
                        self.reset_collapsed_menus(&instance_uid, &reset_menu_uids);
                        self.handle_sync_outcome(outcome);
                        self.handle_free_menus(
                            &instance_uid,
                            &free_menus,
                            &reset_menu_uids,
                            window_bounds,
                        );
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
                        let _ = pairing.outgoing.send(NativeMessage::PairWindowResult {
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
                    let popups = self.popups.clone();
                    let _ = self.app.run_on_main_thread(move || {
                        let _ = crate::panel::open_popup(&app, &popups, request);
                    });
                }
                NativeCommand::ShowPopup {
                    instance_uid,
                    window_uid,
                    menu_uid,
                    request_uid,
                } => {
                    let app = self.app.clone();
                    let surfaces = self.surfaces.clone();
                    let popups = self.popups.clone();
                    let _ = self.app.run_on_main_thread(move || {
                        let _ = crate::panel::show_popup(
                            &app,
                            &surfaces,
                            &popups,
                            &instance_uid,
                            &window_uid,
                            &menu_uid,
                            &request_uid,
                        );
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
                            tokio::time::sleep(Duration::from_millis(POPUP_CLOSE_DELAY_MS)).await;
                            let _ = sender.send(NativeCommand::BeginPopupClose {
                                instance_uid,
                                window_uid,
                                menu_uid,
                                generation,
                            });
                        });
                    }
                }
                NativeCommand::BeginPopupClose {
                    instance_uid,
                    window_uid,
                    menu_uid,
                    generation,
                } => {
                    if let Some(generation) =
                        self.popups
                            .advance_close(&instance_uid, &window_uid, &menu_uid, generation)
                    {
                        let label = popup_label(&instance_uid, &window_uid, &menu_uid);
                        let parent_label = if window_uid.is_empty() {
                            free_label(&instance_uid, &menu_uid)
                        } else {
                            menu_label(&instance_uid, &window_uid, &menu_uid)
                        };
                        if let Some(window) = self.app.get_webview_window(&label) {
                            let _ = crate::panel::clear_popup_hit_region(&window);
                        }
                        let _ = self.app.emit_to(&label, "popup-content-visibility", false);
                        let _ = self
                            .app
                            .emit_to(&parent_label, "popup-closed", menu_uid.clone());
                        let sender = self.native_sender.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(POPUP_HIDE_DELAY_MS)).await;
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
                    if matches!(
                        self.popups
                            .cancel_close(&instance_uid, &window_uid, &menu_uid),
                        Ok(true)
                    ) {
                        let label = popup_label(&instance_uid, &window_uid, &menu_uid);
                        let _ = self.app.emit_to(&label, "popup-content-visibility", true);
                    }
                }
                NativeCommand::SetPopupPointerInside {
                    instance_uid,
                    window_uid,
                    menu_uid,
                    source,
                    inside,
                } => {
                    match self.popups.set_pointer_inside(
                        &instance_uid,
                        &window_uid,
                        &menu_uid,
                        source,
                        inside,
                    ) {
                        Ok(PopupPointerAction::Schedule(generation)) => {
                            let sender = self.native_sender.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(POPUP_CLOSE_DELAY_MS))
                                    .await;
                                let _ = sender.send(NativeCommand::BeginPopupClose {
                                    instance_uid,
                                    window_uid,
                                    menu_uid,
                                    generation,
                                });
                            });
                        }
                        Ok(PopupPointerAction::Cancel) => {
                            let label = popup_label(&instance_uid, &window_uid, &menu_uid);
                            let _ = self.app.emit_to(&label, "popup-content-visibility", true);
                        }
                        Ok(PopupPointerAction::None) | Err(_) => {}
                    }
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

                    for (instance_uid, menus) in self.registry.menu_snapshots() {
                        if next {
                            self.handle_sync_outcome(crate::session::SyncOutcome {
                                instance_uid: instance_uid.clone(),
                                menus: menus.clone(),
                                native_shortcuts: Vec::new(),
                                removed_window_uids: Vec::new(),
                                reset_menu_uids: Vec::new(),
                            });
                            let free_menus = menus
                                .iter()
                                .filter(|synced| synced.is_free())
                                .cloned()
                                .collect::<Vec<_>>();
                            self.handle_free_menus(&instance_uid, &free_menus, &[], None);
                        } else {
                            let window_uids = menus
                                .iter()
                                .filter_map(|synced| {
                                    synced.bound_window().map(|window| window.uid.clone())
                                })
                                .collect::<Vec<_>>();
                            self.hide_instance_windows(&instance_uid, &window_uids);
                            self.hide_instance_free_surfaces(&instance_uid);
                        }
                    }
                    self.refresh_window_levels();
                    self.check_update_tray();
                }
                NativeCommand::ToggleEnableShortcuts => {
                    let next = !self.enable_shortcuts.load(Ordering::Relaxed);
                    self.enable_shortcuts.store(next, Ordering::Relaxed);
                    let mut settings = crate::settings::load(&self.app).unwrap_or_default();
                    settings.enable_shortcuts = next;
                    settings.listener_port = self.socket.port();
                    let _ = crate::settings::save(&self.app, &settings);
                    if next {
                        sync_keyboard_hook(&self.app, self.registry.all_active_shortcut_keys());
                    } else {
                        sync_keyboard_hook(&self.app, HashSet::new());
                    }
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
                NativeCommand::NativeShortcutTriggered {
                    key,
                    foreground_hwnd,
                } => {
                    self.handle_native_shortcut_triggered(&key, foreground_hwnd);
                }
            }
        }
    }

    fn handle_native_shortcut_triggered(&self, key: &str, foreground_hwnd: isize) {
        crate::debug::log(
            "Native:Shortcut",
            format!("Triggered shortcut key '{key}', fg_hwnd={foreground_hwnd}"),
        );
        let matched = if let Ok(handles) = self.browser_window_handles.lock() {
            handles
                .iter()
                .find(|(_, hwnd)| **hwnd == foreground_hwnd)
                .map(|((inst, win), _)| (inst.clone(), Some(win.clone())))
                .or_else(|| {
                    let root = unsafe { GetAncestor(HWND(foreground_hwnd as *mut _), GA_ROOT) };
                    if !root.0.is_null() {
                        let root_hwnd = root.0 as isize;
                        handles
                            .iter()
                            .find(|(_, hwnd)| **hwnd == root_hwnd)
                            .map(|((inst, win), _)| (inst.clone(), Some(win.clone())))
                    } else {
                        None
                    }
                })
        } else {
            None
        };

        let Some((instance_uid, target_window)) = matched else {
            crate::debug::log(
                "Native:Shortcut",
                format!("Foreground hwnd {foreground_hwnd} does not match any paired window; ignoring"),
            );
            return;
        };

        if let Some(shortcut) = self.registry.find_shortcut_by_key(&instance_uid, key) {
            crate::debug::log(
                "Native:Shortcut",
                format!("Invoking shortcut id={} for instance={}", shortcut.id, instance_uid),
            );
            let _ = self.registry.invoke_shortcut(&instance_uid, target_window, &shortcut.id);
        } else {
            crate::debug::log(
                "Native:Shortcut",
                format!("No shortcut found for key '{key}' in instance {instance_uid}"),
            );
        }
    }

    fn sync_active_paired_hwnds(&self) {
        if let Ok(handles) = self.browser_window_handles.lock() {
            let hwnds: HashSet<isize> = handles.values().copied().collect();
            sync_paired_hwnds(&self.app, hwnds);
        }
    }

    fn begin_window_pairing(
        &mut self,
        connection_uid: Uuid,
        instance_uid: String,
        request_uid: String,
        window_uid: String,
        outgoing: UnboundedSender<NativeMessage>,
    ) {
        let fg_opt = foreground_browser_window();
        crate::debug::log(
            "Pairing:Begin",
            format!("inst={instance_uid}, req={request_uid}, win={window_uid}, fg={fg_opt:?}"),
        );
        // The foreground window must be a browser (so we have a real HWND to bind);
        // the identity match is windowUid-based (has_window) plus the extension's
        // focus confirmation in the VerifyWindowPairing round-trip below. The
        // instance already scopes the connection, so no browser-kind comparison is
        // needed.
        let Some((foreground_hwnd, _foreground_browser)) = fg_opt else {
            crate::debug::log(
                "Pairing:Begin",
                "Failed: foreground_browser_window() is None",
            );
            let _ = outgoing.send(NativeMessage::PairWindowResult {
                request_uid,
                window_uid,
                ok: false,
            });
            return;
        };
        let has_window = self.registry.has_window(&instance_uid, &window_uid);
        crate::debug::log(
            "Pairing:Begin",
            format!("has_window={has_window}"),
        );
        if !has_window {
            crate::debug::log(
                "Pairing:Begin",
                "Failed: window not in registry",
            );
            let _ = outgoing.send(NativeMessage::PairWindowResult {
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
        let _ = outgoing.send(NativeMessage::VerifyWindowPairing {
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
        outgoing: UnboundedSender<NativeMessage>,
    ) {
        let Some(pairing) = self.pending_window_pairings.remove(&request_uid) else {
            crate::debug::log(
                "Pairing:Confirm",
                format!("Failed: pending pairing for req={request_uid} not found or expired"),
            );
            let _ = outgoing.send(NativeMessage::PairWindowResult {
                request_uid,
                window_uid,
                ok: false,
            });
            return;
        };
        let fg_current = foreground_browser_window();
        let foreground_matches = fg_current.is_some_and(|(hwnd, _)| hwnd == pairing.hwnd);
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
            self.sync_active_paired_hwnds();
            let menus = self.registry.window_menus(&instance_uid, &window_uid);
            if !menus.is_empty() {
                crate::debug::log(
                    "Pairing:Confirm",
                    format!("Triggering sync_outcome for window {window_uid}"),
                );
                self.handle_sync_outcome(crate::session::SyncOutcome {
                    instance_uid: instance_uid.clone(),
                    menus,
                    native_shortcuts: Vec::new(),
                    removed_window_uids: Vec::new(),
                    reset_menu_uids: Vec::new(),
                });
                self.refresh_window_levels();
            } else {
                crate::debug::log(
                    "Pairing:Confirm",
                    format!("Warning: no menus found for window {window_uid}"),
                );
            }
        }

        let _ = pairing.outgoing.send(NativeMessage::PairWindowResult {
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
        outgoing: UnboundedSender<NativeMessage>,
    ) {
        self.pending_window_pairings
            .retain(|_, pairing| pairing.instance_uid != instance_uid);
        let menu_prefix = instance_surface_prefix("menu", &instance_uid);
        let popup_prefix = instance_surface_prefix("popup", &instance_uid);
        // Preserve free surfaces across a resync instead of destroying and
        // recreating them. Menu/popup surfaces are still fully rebuilt below.
        //
        // Investigation (EVENT_SYSTEM_FOREGROUND logging correlated with surface
        // (re)creation):
        //   - Symptom: on Resync the paired browser drops out of the foreground
        //     and falls behind other windows (it is NOT minimized). Intermittent.
        //   - None of our own windows were ever the foreground window
        //     (GetWindowThreadProcessId never matched our pid for any foreground
        //     change), so it is not our surface / its WebView2 grabbing
        //     activation. The foreground jumped straight from the browser
        //     (chrome.exe) to the shell (explorer.exe, including its no-activate
        //     taskbar windows) and to whatever else happened to be nearby.
        //   - The disturbance correlated strictly with creating a *new* free
        //     surface (is_new=true). Every resync/reconnect that reused an
        //     existing free window (is_new=false) left the foreground untouched.
        //
        // Leading explanation: a free surface is an ownerless top-level window,
        // so when a freshly created one initializes its WebView2 the resulting
        // activation churn has no owner to fall back to and Windows hands the
        // foreground to the shell. Menu/popup surfaces are owned by the browser
        // window, so their recreation falls back to the browser and is harmless.
        //
        // This is a workaround, not a root-cause fix: it only removes the resync
        // trigger by reusing the window. The underlying "creating a new ownerless
        // free WebView2 window perturbs the foreground" is unresolved, so
        // genuinely-new creation (first launch, a newly added free menu, desktop
        // restart) can still exhibit it. The exact micro-mechanism (why the
        // browser loses the foreground when no window of ours takes it) was not
        // pinned down.
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
        self.sync_active_paired_hwnds();
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
                let _ = outgoing.send(NativeMessage::ResyncComplete { request_uid });
            });
        });
    }

    /// Hide (not destroy) every free surface for an instance — used when the
    /// WebSocket disconnects. They are re-shown by the next sync once reconnected.
    fn hide_instance_free_surfaces(&self, instance_uid: &str) {
        let free_prefix = instance_surface_prefix("free", instance_uid);
        let labels: Vec<String> = self
            .app
            .webview_windows()
            .into_keys()
            .filter(|label| label.starts_with(&free_prefix))
            .collect();
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

    /// Reconcile instance-wide free surfaces to the windowless entries in the latest sync.
    /// The extension emits only free menus that should currently exist, so entries absent from
    /// this subset are destroyed. Each remaining menu owns one non-activating topmost window.
    fn handle_free_menus(
        &self,
        instance_uid: &str,
        free_menus: &[SyncedMenu],
        reset_menu_uids: &[String],
        // Bounds (x, y, w, h) of the lastFocused browser window, used to center a
        // free surface that has no saved position (or whose saved spot is now
        // off-screen). None → fall back to the primary monitor center.
        window_bounds: Option<(f64, f64, f64, f64)>,
    ) {
        let display = self.display_panels.load(Ordering::Relaxed);
        let free_prefix = instance_surface_prefix("free", instance_uid);

        struct FreeItem {
            label: String,
            url: String,
            width: f64,
            height: f64,
            free_pos: Option<(f64, f64)>,
            reset_position: bool,
            should_be_visible: bool,
            menu: crate::protocol::SurfaceMenu,
            collapsed: bool,
        }
        let mut desired: Vec<FreeItem> = Vec::new();
        if display {
            for synced in free_menus {
                let menu_uid = synced.view.uid.clone();
                let label = free_label(instance_uid, &menu_uid);
                let collapsed = is_menu_collapsed(&self.collapsed_menus, instance_uid, &menu_uid);
                let geometry = crate::protocol::free_menu_geometry_for_state(
                    &synced.view,
                    &synced.placement,
                    synced.free_position(),
                    collapsed,
                );
                let (width, height) = (geometry.width, geometry.height);
                let url = format!(
                    "index.html?surface=menu&free=1&instanceUid={}&menuUid={}",
                    urlencoding::encode(instance_uid),
                    urlencoding::encode(&menu_uid),
                );
                desired.push(FreeItem {
                    label,
                    url,
                    width,
                    height,
                    free_pos: Some((geometry.x, geometry.y)),
                    reset_position: reset_menu_uids.contains(&menu_uid),
                    // URL-driven visibility: kept alive but hidden when the URL
                    // does not match, mirroring bound menus (no destroy/recreate).
                    should_be_visible: synced.native.visible,
                    menu: crate::protocol::SurfaceMenu::from_synced(synced),
                    collapsed,
                });
            }
        }
        let desired_labels: HashSet<String> = desired.iter().map(|i| i.label.clone()).collect();

        let to_destroy: Vec<String> = self
            .app
            .webview_windows()
            .into_keys()
            .filter(|label| label.starts_with(&free_prefix) && !desired_labels.contains(label))
            .collect();
        if !to_destroy.is_empty() {
            self.surfaces.remove_labels(&to_destroy);
            if let Ok(mut levels) = self.window_levels.lock() {
                levels.retain(|label, _| !to_destroy.contains(label));
            }
        }

        let app = self.app.clone();
        let surfaces = self.surfaces.clone();
        let window_levels = self.window_levels.clone();
        let instance_uid = instance_uid.to_string();
        let _ = self.app.run_on_main_thread(move || {
            for label in &to_destroy {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = crate::panel::safely_destroy_window(&window);
                }
            }
            for item in desired {
                let is_new = app.get_webview_window(&item.label).is_none();
                let window = match app.get_webview_window(&item.label) {
                    Some(window) => {
                        // Only resize on update; leave the position where the user
                        // last dragged it (a fresh saved target position applies on the next
                        // create, not by snapping an open surface).
                        let _ = window.set_size(LogicalSize::new(item.width, item.height));
                        if item.reset_position {
                            let (x, y) = resolve_free_position(
                                &app,
                                item.free_pos,
                                item.width,
                                item.height,
                                window_bounds,
                            );
                            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                        }
                        window
                    }
                    None => {
                        let (x, y) = resolve_free_position(
                            &app,
                            item.free_pos,
                            item.width,
                            item.height,
                            window_bounds,
                        );
                        crate::debug::log(
                            "Native:Free",
                            format!(
                                "build {} at ({x:.0},{y:.0}) size {:.0}x{:.0} bounds={window_bounds:?}",
                                item.label, item.width, item.height
                            ),
                        );
                        let built = WebviewWindowBuilder::new(
                            &app,
                            &item.label,
                            WebviewUrl::App(item.url.into()),
                        )
                        .title("BrowseRail")
                        .inner_size(item.width, item.height)
                        .position(x, y)
                        .decorations(false)
                        .focused(false)
                        .focusable(false)
                        .resizable(false)
                        .shadow(false)
                        .skip_taskbar(true)
                        // Match the proven bound-menu Composition lifecycle:
                        // finish attaching the visual tree while hidden, then
                        // show with SWP_NOACTIVATE after bounds and z-order are set.
                        .transparent(true)
                        .always_on_top(false)
                        .visible(false)
                        .build();
                        match built {
                            Ok(window) => window,
                            Err(error) => {
                                crate::debug::log(
                                    "Native:Free",
                                    format!("Failed to build free surface {}: {error}", item.label),
                                );
                                continue;
                            }
                        }
                    }
                };
                let _ = set_window_no_activate(&window);
                let _ = window.set_ignore_cursor_events(false);
                if is_new {
                    let (x, y) = resolve_free_position(
                        &app,
                        item.free_pos,
                        item.width,
                        item.height,
                        window_bounds,
                    );
                    // Re-apply the initial bounds after WebView2's composition
                    // controller exists. This deliberately mirrors bound menus
                    // and delivers the post-creation WM_SIZE/WM_MOVE pair.
                    let _ = window.set_size(LogicalSize::new(item.width, item.height));
                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                }
                // Free bars are always topmost. Re-assert from the window's
                // ACTUAL ex-style, not a cached value: only re-raise when it
                // truly lost topmost, so a routine sync never leapfrogs the free
                // bar over another menu's open popup (also topmost), yet a bar
                // that dropped below ordinary windows still recovers.
                if !is_window_always_on_top(&window).unwrap_or(false) {
                    let _ = set_window_always_on_top(&window, true);
                }
                if let Ok(mut levels) = window_levels.lock() {
                    levels.insert(item.label.clone(), true);
                }
                if item.should_be_visible {
                    if !surfaces.is_visible(&item.label) {
                        let _ = set_window_visible_without_activation(&window, true);
                        surfaces.mark_visible(&item.label);
                        crate::debug::log(
                            "Native:Free",
                            format!(
                                "shown {} is_new={is_new} visible={:?} outer_pos={:?} inner_size={:?}",
                                item.label,
                                window.is_visible().ok(),
                                window.outer_position().ok(),
                                window.inner_size().ok(),
                            ),
                        );
                    }
                } else if surfaces.is_visible(&item.label) {
                    let _ = set_window_visible_without_activation(&window, false);
                    surfaces.mark_hidden(&item.label);
                }
                // Push the latest content so an already-open free surface refreshes
                // (mirrors the bound menu-state emit).
                let event = MenuStateEvent {
                    instance_uid: &instance_uid,
                    window_uid: None,
                    menu: &item.menu,
                    collapsed: item.collapsed,
                };
                let _ = window.emit_to(&item.label, "menu-state", &event);
            }
        });
    }

    fn hide_popup_window(&self, instance_uid: &str, window_uid: &str, menu_uid: &str) {
        let label = popup_label(instance_uid, window_uid, menu_uid);
        let parent_label = if window_uid.is_empty() {
            free_label(instance_uid, menu_uid)
        } else {
            menu_label(instance_uid, window_uid, menu_uid)
        };
        let closed_menu_uid = menu_uid.to_string();
        self.surfaces.mark_hidden(&label);
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = set_window_visible_without_activation(&window, false);
            }
            let _ = app.emit_to(&parent_label, "popup-closed", closed_menu_uid);
        });
    }

    fn handle_sync_outcome(&self, outcome: crate::session::SyncOutcome) {
        let display = self.display_panels.load(Ordering::Relaxed);
        let instance_uid = outcome.instance_uid;
        let synced_menus = outcome.menus;
        let foreground_hwnd = unsafe { GetForegroundWindow().0 as isize };
        let mut labels_to_destroy = Vec::new();

        crate::debug::log(
            "Native:SyncOutcome",
            format!(
                "outcome: inst={instance_uid}, menus={}, display={display}, fg_hwnd={foreground_hwnd}",
                synced_menus.len()
            ),
        );

        for window_uid in &outcome.removed_window_uids {
            let owner_hwnd = self.browser_window_handles.lock().ok().and_then(|handles| {
                handles
                    .get(&(instance_uid.clone(), window_uid.clone()))
                    .copied()
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
        self.sync_active_paired_hwnds();

        let mut menus_by_window: HashMap<String, (BrowserWindowSnapshot, Vec<SyncedMenu>)> =
            HashMap::new();
        for synced in synced_menus {
            if let MenuTarget::Window { window } = synced.target.clone() {
                menus_by_window
                    .entry(window.uid.clone())
                    .or_insert_with(|| (window, Vec::new()))
                    .1
                    .push(synced);
            }
        }

        let mut sync_items = Vec::new();
        for (window_uid, (window, menus)) in menus_by_window {
            let owner_hwnd = self.browser_window_handles.lock().ok().and_then(|handles| {
                handles
                    .get(&(instance_uid.clone(), window_uid.clone()))
                    .copied()
            });
            crate::debug::log(
                "Native:SyncOutcome",
                format!("window={window_uid}: owner_hwnd={owner_hwnd:?}"),
            );
            let Some(owner_hwnd) = owner_hwnd else {
                crate::debug::log(
                    "Native:SyncOutcome",
                    format!("window={window_uid}: skipped because owner_hwnd is None"),
                );
                continue;
            };
            let desired = menus
                .iter()
                .map(|m| menu_label(&instance_uid, &window_uid, &m.view.uid))
                .collect::<HashSet<_>>();

            let prefix = surface_prefix("menu", &instance_uid, &window_uid);
            for (label, _) in self.app.webview_windows() {
                if label.starts_with(&prefix) && !desired.contains(&label) {
                    labels_to_destroy.push(label);
                }
            }

            for menu in &menus {
                let label = menu_label(&instance_uid, &window_uid, &menu.view.uid);
                let collapsed =
                    is_menu_collapsed(&self.collapsed_menus, &instance_uid, &menu.view.uid);
                let geometry = crate::protocol::compute_menu_geometry_for_state(
                    &window,
                    &menu.view,
                    &menu.placement,
                    collapsed,
                );
                let is_customizing = self.surfaces.is_customizing(&label);
                let effective_always_on_top =
                    menu.native.on_top_mode == crate::protocol::OnTopMode::AlwaysOnTop;
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
                    urlencoding::encode(&window_uid),
                    urlencoding::encode(&menu.view.uid),
                );

                let owner = Some(owner_hwnd);

                // `visible` is the URL-driven gate; attachment mode decides focus follow.
                let is_focused = match menu.native.attachment_mode {
                    AttachmentMode::All => true,
                    AttachmentMode::LastFocused => window.focused,
                    AttachmentMode::Free => false,
                };
                let should_be_visible = display && menu.native.visible && is_focused;

                sync_items.push(MenuSyncItem {
                    label,
                    url,
                    geometry,
                    always_on_top: effective_always_on_top,
                    owner_hwnd: owner,
                    should_be_visible,
                    is_customizing,
                    geometry_changed,
                    window_uid: window_uid.clone(),
                    menu: crate::protocol::SurfaceMenu::from_synced(menu),
                    collapsed,
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
        let instance_uid_for_event = instance_uid.to_string();

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
                                format!(
                                    "{}: set_window_owner to {owner_hwnd} succeeded",
                                    item.label
                                ),
                            );
                            true
                        }
                        Err(err) => {
                            crate::debug::log(
                                "Native:Window",
                                format!(
                                    "{}: set_window_owner to {owner_hwnd} FAILED: {err}",
                                    item.label
                                ),
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

                // Re-assert the topmost level from the window's ACTUAL ex-style,
                // not a cached value. set_window_owner (HWND_NOTOPMOST) clears
                // topmost whenever the owner is (re)attached, so an always-on-top
                // bar would otherwise silently drop below ordinary browser
                // windows and never recover — a cached level still reading
                // "topmost" makes a cache-based guard skip the fix. Reading the
                // live style fixes it in the same pass and, because we only
                // re-raise when it truly lost topmost, avoids leapfrogging an
                // open popup (topmost too) on routine syncs.
                let actual_top = is_window_always_on_top(&window).unwrap_or(false);
                if actual_top != item.always_on_top {
                    let _ = set_window_always_on_top(&window, item.always_on_top);
                }
                if let Ok(mut levels) = window_levels.lock() {
                    levels.insert(item.label.clone(), item.always_on_top);
                }
                if is_new || item.geometry_changed {
                    let _ = window.set_ignore_cursor_events(false);
                    if !item.is_customizing {
                        let _ = window
                            .set_size(LogicalSize::new(item.geometry.width, item.geometry.height));
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

                let event = MenuStateEvent {
                    instance_uid: &instance_uid_for_event,
                    window_uid: Some(&item.window_uid),
                    menu: &item.menu,
                    collapsed: item.collapsed,
                };
                let _ = window.emit_to(&item.label, "menu-state", &event);
            }
        });
    }

    fn prune_collapsed_menus(&self, instance_uid: &str, synced_menus: &[SyncedMenu]) {
        let has_toggle = |view: &crate::protocol::MenuView| {
            view.items
                .iter()
                .any(|item| matches!(item, crate::protocol::LayoutEntry::MenuToggle { .. }))
        };
        let valid_menu_uids: HashSet<&str> = synced_menus
            .iter()
            .map(|synced| &synced.view)
            .filter(|view| has_toggle(view))
            .map(|view| view.uid.as_str())
            .collect();

        let mut menus = match self.collapsed_menus.lock() {
            Ok(menus) => menus,
            Err(_) => return,
        };
        let before = menus.len();
        menus.retain(|item| {
            item.instance_uid != instance_uid || valid_menu_uids.contains(item.menu_uid.as_str())
        });
        if menus.len() == before {
            return;
        }

        let next = menus.clone();
        drop(menus);
        let mut settings = crate::settings::load(&self.app).unwrap_or_default();
        settings.collapsed_menus = next;
        if let Err(error) = crate::settings::save(&self.app, &settings) {
            crate::debug::log(
                "Native:CollapsedMenus",
                format!("Failed to persist collapsed menus: {error}"),
            );
        }
    }

    fn reset_collapsed_menus(&self, instance_uid: &str, reset_menu_uids: &[String]) {
        if reset_menu_uids.is_empty() {
            return;
        }

        let mut menus = match self.collapsed_menus.lock() {
            Ok(menus) => menus,
            Err(_) => return,
        };
        let before = menus.len();
        menus.retain(|item| {
            item.instance_uid != instance_uid
                || !reset_menu_uids
                    .iter()
                    .any(|menu_uid| menu_uid == &item.menu_uid)
        });
        if menus.len() == before {
            return;
        }

        let next = menus.clone();
        drop(menus);
        let mut settings = crate::settings::load(&self.app).unwrap_or_default();
        settings.collapsed_menus = next;
        if let Err(error) = crate::settings::save(&self.app, &settings) {
            crate::debug::log(
                "Native:CollapsedMenus",
                format!("Failed to persist reset collapsed menus: {error}"),
            );
        }
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

        for snapshot in self.registry.instance_menu_snapshots() {
            for synced in snapshot.menus {
                let MenuTarget::Window { window } = synced.target else {
                    continue;
                };
                let owner_hwnd = browser_window_handles
                    .get(&(snapshot.instance_uid.clone(), window.uid.clone()))
                    .copied();
                let always_on_top =
                    synced.native.on_top_mode == crate::protocol::OnTopMode::AlwaysOnTop;
                let is_focused = match synced.native.attachment_mode {
                    AttachmentMode::All => true,
                    AttachmentMode::LastFocused => window.focused,
                    AttachmentMode::Free => false,
                };
                let should_be_visible =
                    display && owner_hwnd.is_some() && synced.native.visible && is_focused;
                let menu_label = menu_label(&snapshot.instance_uid, &window.uid, &synced.view.uid);
                let popup_label = popup_label(&snapshot.instance_uid, &window.uid, &synced.view.uid);
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
        let enable_shortcuts = self.enable_shortcuts.load(Ordering::Relaxed);
        let lock_editing = self.lock_editing.load(Ordering::Relaxed);

        let next = TrayStateSnapshot {
            server_text,
            extension_lines,
            surfaces_text,
            tooltip,
            display_panels,
            enable_shortcuts,
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
                    // Display the reported browser string as-is (no enumeration);
                    // fall back to "Connected" when absent.
                    let browser = ext
                        .browser
                        .as_deref()
                        .filter(|b| !b.is_empty())
                        .unwrap_or("Connected");
                    let label = ext
                        .label
                        .as_deref()
                        .filter(|l| !l.is_empty())
                        .unwrap_or(&ext.instance_uid);
                    Msg::ExtensionConnected { browser, label }.localized()
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
            Msg::TooltipExtConnected {
                count: active.len(),
            }
            .localized()
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
