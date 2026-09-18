//! Runtime i18n for the desktop tray menu, tooltip, and native window titles.
//!
//! The catalog covers strings rendered by Rust (the tray built in `lib.rs` and the
//! status text formatted in `native.rs`). `Lang` mirrors the two locales the apps
//! ship (`en`, `zh-CN`); English is the ultimate fallback. The active language is a
//! process-global so the tray can be rebuilt on demand; the frontend drives it via
//! `set_language` (wired in a later step), while `detect_system_lang` provides the
//! initial best-effort default. Browser brand names are proper nouns, not translated.
//!
//! Unused until the tray/window code is switched over, hence the module-wide allow.
#![allow(dead_code)]

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    ZhCn,
}

impl Lang {
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::ZhCn => "zh-CN",
        }
    }

    /// Map a BCP-47-ish tag to a shipped locale: `zh*` -> zh-CN, everything else -> en.
    pub fn from_tag(tag: &str) -> Lang {
        if tag.to_ascii_lowercase().starts_with("zh") {
            Lang::ZhCn
        } else {
            Lang::En
        }
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        match code {
            "en" => Some(Lang::En),
            "zh-CN" => Some(Lang::ZhCn),
            _ => None,
        }
    }
}

// 0 = En, 1 = ZhCn.
static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set_language(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    if CURRENT.load(Ordering::Relaxed) == Lang::ZhCn as u8 {
        Lang::ZhCn
    } else {
        Lang::En
    }
}

/// Best-effort default from the environment. The real value is set by the frontend,
/// which reads the webview/OS language; this only seeds the initial tray on startup.
pub fn detect_system_lang() -> Lang {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                return Lang::from_tag(&value);
            }
        }
    }
    Lang::En
}

/// A user-facing string produced by the Rust side, with the data it interpolates.
pub enum Msg<'a> {
    // Tray: listener status line
    ListenerStarting,
    ListenerError,
    ListenerListening { port: u16 },
    ListenerStopped,
    // Tray: extension status line
    ExtensionDisconnected,
    ExtensionConnected { browser: &'a str, label: &'a str },
    // Tray: menus/surfaces status line
    MenusVisibleCustomizing { visible: usize, customizing: usize },
    MenusVisible { visible: usize },
    MenusHidden { hidden: usize },
    MenusNone,
    // Tray: actionable items
    DisplayMenus,
    Settings,
    Quit,
    // Tray tooltip fragments
    TooltipServerError,
    TooltipServerStopped,
    TooltipExtDisconnected,
    TooltipExtConnected { count: usize },
    TooltipPanelsCustomizing { visible: usize },
    TooltipPanels { visible: usize },
    // Native window titles
    WindowSettingsTitle,
}

impl Msg<'_> {
    /// Render in the given language.
    pub fn text(&self, lang: Lang) -> String {
        match lang {
            Lang::En => self.en(),
            Lang::ZhCn => self.zh(),
        }
    }

    /// Render in the current process-global language.
    pub fn localized(&self) -> String {
        self.text(current())
    }

    fn en(&self) -> String {
        match self {
            Msg::ListenerStarting => "○ Listener: Starting…".into(),
            Msg::ListenerError => "! Listener: Error".into(),
            Msg::ListenerListening { port } => format!("● Listener: 127.0.0.1:{port}"),
            Msg::ListenerStopped => "○ Listener: Stopped".into(),
            Msg::ExtensionDisconnected => "○ Extension: Disconnected".into(),
            Msg::ExtensionConnected { browser, label } => {
                format!("● Extension: {browser} ({label})")
            }
            Msg::MenusVisibleCustomizing {
                visible,
                customizing,
            } => format!("● Menus: {visible} visible, {customizing} customizing"),
            Msg::MenusVisible { visible } => format!("● Menus: {visible} visible"),
            Msg::MenusHidden { hidden } => format!("○ Menus: {hidden} hidden (ready)"),
            Msg::MenusNone => "○ Menus: None".into(),
            Msg::DisplayMenus => "Display menus".into(),
            Msg::Settings => "Settings…".into(),
            Msg::Quit => "Quit".into(),
            Msg::TooltipServerError => "Error".into(),
            Msg::TooltipServerStopped => "Stopped".into(),
            Msg::TooltipExtDisconnected => "Ext: Disconnected".into(),
            Msg::TooltipExtConnected { count } => format!("Ext: {count} connected"),
            Msg::TooltipPanelsCustomizing { visible } => {
                format!(" ({visible} menus, customizing)")
            }
            Msg::TooltipPanels { visible } => format!(" ({visible} menus)"),
            Msg::WindowSettingsTitle => "BrowseRail Settings".into(),
        }
    }

    fn zh(&self) -> String {
        match self {
            Msg::ListenerStarting => "○ 监听：启动中…".into(),
            Msg::ListenerError => "! 监听：错误".into(),
            Msg::ListenerListening { port } => format!("● 监听：127.0.0.1:{port}"),
            Msg::ListenerStopped => "○ 监听：已停止".into(),
            Msg::ExtensionDisconnected => "○ 扩展：未连接".into(),
            Msg::ExtensionConnected { browser, label } => format!("● 扩展：{browser}（{label}）"),
            Msg::MenusVisibleCustomizing {
                visible,
                customizing,
            } => format!("● 菜单：{visible} 显示，{customizing} 自定义中"),
            Msg::MenusVisible { visible } => format!("● 菜单：{visible} 显示"),
            Msg::MenusHidden { hidden } => format!("○ 菜单：{hidden} 隐藏（就绪）"),
            Msg::MenusNone => "○ 菜单：无".into(),
            Msg::DisplayMenus => "显示菜单".into(),
            Msg::Settings => "设置…".into(),
            Msg::Quit => "退出".into(),
            Msg::TooltipServerError => "错误".into(),
            Msg::TooltipServerStopped => "已停止".into(),
            Msg::TooltipExtDisconnected => "扩展：未连接".into(),
            Msg::TooltipExtConnected { count } => format!("扩展：已连接 {count}"),
            Msg::TooltipPanelsCustomizing { visible } => format!("（{visible} 菜单，自定义中）"),
            Msg::TooltipPanels { visible } => format!("（{visible} 菜单）"),
            Msg::WindowSettingsTitle => "BrowseRail 设置".into(),
        }
    }
}
