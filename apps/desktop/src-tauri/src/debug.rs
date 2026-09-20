use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

static DEBUG_ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_debug_enabled(enabled: bool) {
    DEBUG_ENABLED.store(enabled, Ordering::Relaxed);
}

pub fn is_debug_enabled() -> bool {
    DEBUG_ENABLED.load(Ordering::Relaxed)
}

#[derive(Clone, serde::Serialize)]
pub struct DebugLogEntry {
    pub timestamp_ms: u64,
    pub tag: String,
    pub message: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ForegroundDebugInfo {
    pub hwnd: isize,
    pub title: String,
    pub process_id: u32,
    pub exe_name: String,
    pub exe_path: String,
    pub detected_browser: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct PairedWindowInfo {
    pub instance_uid: String,
    pub window_uid: String,
    pub hwnd: isize,
}

#[derive(Clone, serde::Serialize, Default)]
pub struct DebugStateSummary {
    pub active_instances: Vec<String>,
    pub paired_windows: Vec<PairedWindowInfo>,
    pub window_levels: HashMap<String, bool>,
    pub window_owners: HashMap<String, isize>,
    pub visible_surfaces: Vec<String>,
}

static LOG_BUFFER: LazyLock<Mutex<VecDeque<DebugLogEntry>>> =
    LazyLock::new(|| Mutex::new(VecDeque::with_capacity(300)));

static STATE_PROVIDER: LazyLock<Mutex<Option<Box<dyn Fn() -> DebugStateSummary + Send + Sync>>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn register_state_provider<F>(provider: F)
where
    F: Fn() -> DebugStateSummary + Send + Sync + 'static,
{
    if let Ok(mut lock) = STATE_PROVIDER.lock() {
        *lock = Some(Box::new(provider));
    }
}

pub fn get_state_summary() -> DebugStateSummary {
    STATE_PROVIDER
        .lock()
        .ok()
        .and_then(|lock| lock.as_ref().map(|f| f()))
        .unwrap_or_default()
}

pub fn log(tag: impl Into<String>, message: impl Into<String>) {
    if !is_debug_enabled() {
        return;
    }
    let tag = tag.into();
    let message = message.into();
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let entry = DebugLogEntry {
        timestamp_ms,
        tag: tag.clone(),
        message: message.clone(),
    };

    let log_line = format!("[{timestamp_ms}][{tag}] {message}\n");
    eprint!("{log_line}");

    if let Ok(mut buffer) = LOG_BUFFER.lock() {
        if buffer.len() >= 300 {
            buffer.pop_front();
        }
        buffer.push_back(entry);
    }
}

pub fn get_recent_logs() -> Vec<DebugLogEntry> {
    LOG_BUFFER
        .lock()
        .map(|b| b.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
pub fn inspect_foreground_window() -> Option<ForegroundDebugInfo> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::core::PWSTR;

    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }

    let mut title_buf = [0u16; 512];
    let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buf) };
    let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };

    let mut exe_path = String::new();
    let mut exe_name = String::new();
    let mut detected_browser = None;

    if process_id != 0 {
        if let Ok(process) =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
        {
            let mut path_buf = [0u16; 1024];
            let mut length = path_buf.len() as u32;
            if unsafe {
                QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    PWSTR(path_buf.as_mut_ptr()),
                    &mut length,
                )
            }
            .is_ok()
            {
                let full = String::from_utf16_lossy(&path_buf[..length as usize]);
                exe_name = full
                    .rsplit(['\\', '/'])
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                detected_browser = match exe_name.as_str() {
                    "brave.exe" => Some("brave".to_string()),
                    "chrome.exe" | "chromium.exe" | "thorium.exe" => Some("chrome".to_string()),
                    "msedge.exe" => Some("edge".to_string()),
                    "firefox.exe" | "floorp.exe" | "librewolf.exe" | "waterfox.exe" => {
                        Some("firefox".to_string())
                    }
                    "opera.exe" | "opera_gx.exe" => Some("opera".to_string()),
                    "vivaldi.exe" => Some("vivaldi".to_string()),
                    _ => None,
                };
                exe_path = full;
            }
            let _ = unsafe { CloseHandle(process) };
        }
    }

    Some(ForegroundDebugInfo {
        hwnd: hwnd.0 as isize,
        title,
        process_id,
        exe_name,
        exe_path,
        detected_browser,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn inspect_foreground_window() -> Option<ForegroundDebugInfo> {
    None
}

#[derive(Clone, serde::Serialize)]
pub struct DesktopDebugSnapshot {
    pub timestamp_ms: u64,
    pub foreground_window: Option<ForegroundDebugInfo>,
    pub state_summary: DebugStateSummary,
    pub recent_logs: Vec<DebugLogEntry>,
}

pub fn get_debug_snapshot() -> DesktopDebugSnapshot {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    DesktopDebugSnapshot {
        timestamp_ms,
        foreground_window: inspect_foreground_window(),
        state_summary: get_state_summary(),
        recent_logs: get_recent_logs(),
    }
}
