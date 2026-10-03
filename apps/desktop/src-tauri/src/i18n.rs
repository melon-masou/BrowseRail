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

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

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
    EnableShortcuts,
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

/// Translatable text lives in the shared i18n package (`packages/i18n/src/native.json`),
/// embedded at compile time so Rust and the DOM apps draw from one source. This file
/// only maps each `Msg` variant to its key and the values it interpolates.
type Catalog = HashMap<String, HashMap<String, String>>;

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../packages/i18n/src/native.json"
        )))
        .expect("native.json is a valid { locale: { key: text } } catalog")
    })
}

/// Look up a key in the given language, falling back to English, then to the key itself.
fn tr(lang: Lang, key: &str) -> String {
    let cat = catalog();
    cat.get(lang.code())
        .and_then(|table| table.get(key))
        .or_else(|| cat.get("en").and_then(|table| table.get(key)))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

fn interpolate(mut text: String, params: &[(&str, String)]) -> String {
    for (name, value) in params {
        text = text.replace(&format!("{{{name}}}"), value);
    }
    text
}

impl Msg<'_> {
    /// The key and interpolation values for this message. Keeping this map here (rather
    /// than the strings) preserves type-safe call sites while the text stays in JSON.
    fn parts(&self) -> (&'static str, Vec<(&'static str, String)>) {
        match self {
            Msg::ListenerStarting => ("tray.listenerStarting", vec![]),
            Msg::ListenerError => ("tray.listenerError", vec![]),
            Msg::ListenerListening { port } => {
                ("tray.listenerListening", vec![("port", port.to_string())])
            }
            Msg::ListenerStopped => ("tray.listenerStopped", vec![]),
            Msg::ExtensionDisconnected => ("tray.extensionDisconnected", vec![]),
            Msg::ExtensionConnected { browser, label } => (
                "tray.extensionConnected",
                vec![("browser", browser.to_string()), ("label", label.to_string())],
            ),
            Msg::MenusVisibleCustomizing {
                visible,
                customizing,
            } => (
                "tray.menusVisibleCustomizing",
                vec![
                    ("visible", visible.to_string()),
                    ("customizing", customizing.to_string()),
                ],
            ),
            Msg::MenusVisible { visible } => {
                ("tray.menusVisible", vec![("visible", visible.to_string())])
            }
            Msg::MenusHidden { hidden } => {
                ("tray.menusHidden", vec![("hidden", hidden.to_string())])
            }
            Msg::MenusNone => ("tray.menusNone", vec![]),
            Msg::DisplayMenus => ("tray.displayMenus", vec![]),
            Msg::EnableShortcuts => ("tray.enableShortcuts", vec![]),
            Msg::Settings => ("tray.settings", vec![]),
            Msg::Quit => ("tray.quit", vec![]),
            Msg::TooltipServerError => ("tray.tooltipServerError", vec![]),
            Msg::TooltipServerStopped => ("tray.tooltipServerStopped", vec![]),
            Msg::TooltipExtDisconnected => ("tray.tooltipExtDisconnected", vec![]),
            Msg::TooltipExtConnected { count } => {
                ("tray.tooltipExtConnected", vec![("count", count.to_string())])
            }
            Msg::TooltipPanelsCustomizing { visible } => (
                "tray.tooltipPanelsCustomizing",
                vec![("visible", visible.to_string())],
            ),
            Msg::TooltipPanels { visible } => {
                ("tray.tooltipPanels", vec![("visible", visible.to_string())])
            }
            Msg::WindowSettingsTitle => ("window.settingsTitle", vec![]),
        }
    }

    /// Render in the given language.
    pub fn text(&self, lang: Lang) -> String {
        let (key, params) = self.parts();
        interpolate(tr(lang, key), &params)
    }

    /// Render in the current process-global language.
    pub fn localized(&self) -> String {
        self.text(current())
    }
}
