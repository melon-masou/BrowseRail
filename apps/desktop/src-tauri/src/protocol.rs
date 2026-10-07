use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 2;

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ExtensionMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(rename = "protocolVersion")]
        protocol_version: u16,
        instance: BrowserInstance,
    },
    #[serde(rename = "sync")]
    Sync {
        revision: u64,
        menus: Vec<SyncedMenu>,
        #[serde(default, rename = "resetMenuUids")]
        reset_menu_uids: Vec<String>,
        #[serde(default, rename = "nativeShortcuts")]
        native_shortcuts: Vec<SyncedNativeShortcut>,
    },
    #[serde(rename = "actionResult")]
    ActionResult {
        #[serde(rename = "menuUid")]
        menu_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: Option<String>,
        #[serde(rename = "actionUid")]
        action_uid: String,
        error: Option<String>,
    },
    #[serde(rename = "pairWindow")]
    PairWindow {
        #[serde(rename = "requestUid")]
        request_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: String,
    },
    #[serde(rename = "confirmWindowPairing")]
    ConfirmWindowPairing {
        #[serde(rename = "requestUid")]
        request_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: String,
    },
    #[serde(rename = "clientDebugLog")]
    ClientDebugLog {
        time: String,
        tag: String,
        message: String,
        details: Option<serde_json::Value>,
    },
    #[serde(rename = "resync")]
    Resync {
        #[serde(rename = "requestUid")]
        request_uid: String,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat,
    #[serde(rename = "setEditing")]
    SetEditing { editing: bool },
    #[serde(rename = "detach")]
    Detach,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum NativeMessage {
    #[serde(rename = "editingState")]
    EditingState { editing: bool },
    #[serde(rename = "ready")]
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u16,
    },
    #[serde(rename = "invoke")]
    Invoke {
        #[serde(rename = "actionUid")]
        action_uid: String,
        // A free (detached) surface omits the target window; the extension then
        // resolves it as the instance's current lastFocused window.
        #[serde(rename = "windowUid", skip_serializing_if = "Option::is_none")]
        window_uid: Option<String>,
        #[serde(rename = "menuUid", skip_serializing_if = "Option::is_none")]
        menu_uid: Option<String>,
    },
    #[serde(rename = "updateMenuLayout")]
    UpdateMenuLayout {
        #[serde(rename = "menuUid")]
        menu_uid: String,
        placement: MenuPlacement,
        spacing: MenuSpacing,
        settings: NativeBarSettings,
        #[serde(rename = "applyToAll")]
        apply_to_all: Vec<BarSettingsGroup>,
    },
    #[serde(rename = "verifyWindowPairing")]
    VerifyWindowPairing {
        #[serde(rename = "requestUid")]
        request_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: String,
    },
    #[serde(rename = "pairWindowResult")]
    PairWindowResult {
        #[serde(rename = "requestUid")]
        request_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: String,
        ok: bool,
    },
    #[serde(rename = "resyncComplete")]
    ResyncComplete {
        #[serde(rename = "requestUid")]
        request_uid: String,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInstance {
    pub uid: String,
    // Best-effort browser identifier for display only (e.g. "chrome"). An open
    // string with an extension-side fallback; never matched or enumerated here.
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

/// How a bound menu attaches to browser windows. `free` is a positioning
/// concept, kept in the same sum type as `all`/`lastFocused` because a free
/// surface (one shared floating window) is mutually exclusive with per-window
/// `all`. URL-driven hiding is expressed by `MenuNativeProps.visible`, not by an
/// attach mode, so there is deliberately no `None` variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentMode {
    #[default]
    LastFocused,
    All,
    Free,
}

impl<'de> Deserialize<'de> for AttachmentMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "all" => Ok(AttachmentMode::All),
            "free" => Ok(AttachmentMode::Free),
            _ => Ok(AttachmentMode::LastFocused),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum OnTopMode {
    #[default]
    AboveBrowser,
    AlwaysOnTop,
}

impl<'de> Deserialize<'de> for OnTopMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "alwaysOnTop" => Ok(OnTopMode::AlwaysOnTop),
            _ => Ok(OnTopMode::AboveBrowser),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExpandDirection {
    Down,
    Up,
    Right,
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExpandAlignment {
    Edge,
    Center,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BarAutoHide {
    #[default]
    Off,
    Start,
    End,
}

fn default_auto_hide_padding() -> f64 { 6.0 }

pub fn deserialize_optional_expand_direction<'de, D>(
    deserializer: D,
) -> Result<Option<ExpandDirection>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<String> = Option::deserialize(deserializer)?;
    match opt.as_deref() {
        Some("down") => Ok(Some(ExpandDirection::Down)),
        Some("up") => Ok(Some(ExpandDirection::Up)),
        Some("right") => Ok(Some(ExpandDirection::Right)),
        Some("left") => Ok(Some(ExpandDirection::Left)),
        _ => Ok(None),
    }
}

// See packages/protocol/src/menu.ts and native.ts for the authoritative split
// between the RENDER axis (MenuView) and the NATIVE axis (MenuPlacement /
// MenuNativeProps / MenuTarget). These structs mirror those TypeScript types.

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SyncedNativeShortcut {
    pub id: String,
    pub key: String,
}

/// RENDER axis: the item tree and appearance the surface webview draws. Never
/// describes window geometry, sizing-as-a-window, or when a surface shows.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuView {
    pub uid: String,
    #[serde(default)]
    pub items: Vec<LayoutEntry>,
    #[serde(default)]
    pub orientation: MenuOrientation,
    #[serde(default)]
    pub auto_hide: BarAutoHide,
    #[serde(default = "default_auto_hide_padding")]
    pub auto_hide_padding: f64,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_expand_direction")]
    pub expand_direction: Option<ExpandDirection>,
    #[serde(default)]
    pub expand_alignment: Option<ExpandAlignment>,
    #[serde(default)]
    pub button_font_size: Option<f64>,
    #[serde(default)]
    pub popup_font_size: Option<f64>,
    #[serde(default)]
    pub gap_ratio: Option<f64>,
    #[serde(default)]
    pub extra_gaps: std::collections::HashMap<String, f64>,
    #[serde(default)]
    pub dock_color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSpacing {
    pub gap_ratio: f64,
    pub extra_gaps: std::collections::HashMap<String, f64>,
}

impl MenuSpacing {
    pub fn is_valid(&self) -> bool {
        self.gap_ratio.is_finite() && self.gap_ratio >= 0.0
            && self.extra_gaps.values().all(|ratio| ratio.is_finite() && *ratio >= 0.0)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BarSettingsGroup { Orientation, Font, Expand, AutoHide, Attachment, OnTop }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBarSettings {
    pub orientation: MenuOrientation,
    #[serde(default)]
    pub font_family: String,
    #[serde(default)]
    pub auto_hide: BarAutoHide,
    #[serde(default = "default_auto_hide_padding")]
    pub auto_hide_padding: f64,
    pub button_font_size: f64,
    pub popup_font_size: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expand_direction: Option<ExpandDirection>,
    pub expand_alignment: ExpandAlignment,
    pub attachment_mode: AttachmentMode,
    pub on_top_mode: OnTopMode,
}
impl NativeBarSettings {
    pub fn is_valid(&self) -> bool {
        self.auto_hide_padding.is_finite() && self.auto_hide_padding >= 0.0
            && self.button_font_size.is_finite() && (self.button_font_size == -1.0 || self.button_font_size >= 1.0)
            && self.popup_font_size.is_finite() && (self.popup_font_size == -1.0 || self.popup_font_size >= 1.0)
            && (self.attachment_mode != AttachmentMode::Free || self.on_top_mode == OnTopMode::AlwaysOnTop)
    }
    pub fn apply_view(&self, view: &mut MenuView) {
        view.orientation = self.orientation;
        view.font_family = Some(self.font_family.trim().to_string());
        view.auto_hide = self.auto_hide;
        view.auto_hide_padding = self.auto_hide_padding;
        view.button_font_size = Some(self.button_font_size);
        view.popup_font_size = Some(self.popup_font_size);
        view.expand_direction = self.expand_direction;
        view.expand_alignment = Some(self.expand_alignment);
    }
}

/// NATIVE axis: window behavior the webview never reads. `visible` is the
/// URL-driven show/hide gate; when false the surface is kept alive but hidden
/// (no destroy/recreate flicker), for both bound and free menus.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuNativeProps {
    #[serde(default)]
    pub attachment_mode: AttachmentMode,
    #[serde(default)]
    pub on_top_mode: OnTopMode,
    #[serde(default = "default_visible")]
    pub visible: bool,
}

fn default_visible() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedMenu {
    pub view: MenuView,
    pub placement: MenuPlacement,
    pub native: MenuNativeProps,
    pub target: MenuTarget,
}

/// NATIVE axis, downlink only: where a surface lives. A free surface's absolute
/// position is NOT here — it lives in `MenuPlacement.free_position`, so the whole
/// placement round-trips as one unit.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuTarget {
    Window {
        window: BrowserWindowSnapshot,
    },
    Free {
        #[serde(default, rename = "referenceWindow")]
        reference_window: Option<BrowserWindowSnapshot>,
    },
}

impl SyncedMenu {
    pub fn bound_window(&self) -> Option<&BrowserWindowSnapshot> {
        match &self.target {
            MenuTarget::Window { window } => Some(window),
            MenuTarget::Free { .. } => None,
        }
    }

    pub fn reference_window(&self) -> Option<&BrowserWindowSnapshot> {
        match &self.target {
            MenuTarget::Window { window } => Some(window),
            MenuTarget::Free {
                reference_window, ..
            } => reference_window.as_ref(),
        }
    }

    pub fn free_position(&self) -> Option<FreePosition> {
        self.placement.free_position
    }

    pub fn is_free(&self) -> bool {
        matches!(self.target, MenuTarget::Free { .. })
    }
}

/// Desktop→webview projection of a synced menu: render content (flattened) plus
/// the resolved geometry the surface lays itself out from. This is an internal
/// desktop contract, not the extension wire protocol; the webview reads the view
/// fields, placement and native edit settings. Runtime visibility/targets remain in Rust. Mirrors
/// `SurfaceMenu` in apps/desktop/src/pages/menu.ts.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceMenu {
    pub attachment_mode: AttachmentMode,
    pub on_top_mode: OnTopMode,
    #[serde(flatten)]
    pub view: MenuView,
    pub placement: MenuPlacement,
}

impl SurfaceMenu {
    pub fn from_synced(synced: &SyncedMenu) -> Self {
        Self {
            attachment_mode: synced.native.attachment_mode,
            on_top_mode: synced.native.on_top_mode,
            view: synced.view.clone(),
            placement: synced.placement,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MenuOrientation {
    #[default]
    Row,
    Column,
}

impl<'de> Deserialize<'de> for MenuOrientation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "column" => Ok(MenuOrientation::Column),
            _ => Ok(MenuOrientation::Row),
        }
    }
}

/// A bound menu's position relative to its owning browser window.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MenuBoundPosition {
    #[serde(default)]
    pub anchor: MenuAnchor,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
}

/// NATIVE axis: geometry the desktop decides and echoes back after a drag/resize
/// (round-trips extension⇄desktop). Each mode reads its own field —
/// `bound_position` while attached, `free_position` while detached — and both
/// may coexist because a menu switches between them. `item_width`/`item_height`
/// are the shared per-item pixel size set by resizing.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuPlacement {
    #[serde(default)]
    pub bound_position: MenuBoundPosition,
    #[serde(default)]
    pub free_position: Option<FreePosition>,
    #[serde(default)]
    pub item_width: Option<f64>,
    #[serde(default)]
    pub item_height: Option<f64>,
}

/// Internal derived geometry for positioning and sizing a menu window in Tauri.
/// Total width/height and screen coordinates are computed dynamically from
/// item count, item dimensions (item_width / item_height), gap, and anchor offsets.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComputedMenuGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MenuAnchor {
    #[default]
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl<'de> Deserialize<'de> for MenuAnchor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        match s.as_str() {
            "topRight" => Ok(MenuAnchor::TopRight),
            "bottomLeft" => Ok(MenuAnchor::BottomLeft),
            "bottomRight" => Ok(MenuAnchor::BottomRight),
            _ => Ok(MenuAnchor::TopLeft),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWindowSnapshot {
    pub uid: String,
    pub bounds: WindowBounds,
    #[serde(default)]
    pub focused: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayoutEntry {
    Bookmark {
        uid: String,
        label: String,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        rename: Option<String>,
    },
    MenuFold {
        uid: String,
        label: String,
        #[serde(default)]
        color: Option<String>,
    },
    MenusToggle {
        uid: String,
        label: String,
        #[serde(default)]
        color: Option<String>,
    },
    BrowserAction {
        uid: String,
        label: String,
        #[serde(default)]
        color: Option<String>,
    },
    Folder {
        uid: String,
        label: String,
        #[serde(default)]
        color: Option<String>,
        children: Vec<LayoutEntry>,
        #[serde(default)]
        expand_on_hover: Option<bool>,
        #[serde(default, deserialize_with = "deserialize_optional_expand_direction")]
        expand_direction: Option<ExpandDirection>,
        #[serde(default)]
        rename: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

fn menu_gap_ratio_after(view: &MenuView, index: usize) -> f64 {
    if index + 1 >= view.items.len() { return 0.0; }
    let uid = match &view.items[index] {
        LayoutEntry::Bookmark { uid, .. }
        | LayoutEntry::Folder { uid, .. }
        | LayoutEntry::MenuFold { uid, .. }
        | LayoutEntry::MenusToggle { uid, .. }
        | LayoutEntry::BrowserAction { uid, .. } => Some(uid),
        LayoutEntry::Unknown => None,
    };
    view.gap_ratio.unwrap_or(0.11)
        + uid.and_then(|id| view.extra_gaps.get(id)).copied().unwrap_or(0.0)
}

pub fn menu_length_factor(view: &MenuView) -> f64 {
    view.items.len().max(1) as f64
        + (0..view.items.len()).map(|index| menu_gap_ratio_after(view, index)).sum::<f64>()
}

/// Canvas space for the shared bar frame, matching menu-ui's `barFrameInsets`.
pub fn menu_frame_insets(view: &MenuView) -> (f64, f64) {
    match view.orientation {
        MenuOrientation::Row => (5.0, 1.0),
        MenuOrientation::Column => (1.0, 5.0),
    }
}

/// Total window dimensions include the frame; placement still stores button size.
pub fn menu_total_size(view: &MenuView, placement: &MenuPlacement) -> (f64, f64) {
    let factor = menu_length_factor(view);
    let item_width = placement.item_width.unwrap_or(84.0);
    let item_height = placement.item_height.unwrap_or(36.0);
    let (frame_x, frame_y) = menu_frame_insets(view);
    match view.orientation {
        MenuOrientation::Row => (
            factor * item_width + 2.0 * frame_x,
            item_height + 2.0 * frame_y,
        ),
        MenuOrientation::Column => (
            item_width + 2.0 * frame_x,
            factor * item_height + 2.0 * frame_y,
        ),
    }
}

pub fn menu_total_size_for_state(
    view: &MenuView,
    placement: &MenuPlacement,
    collapsed: bool,
) -> (f64, f64) {
    if collapsed {
        let (frame_x, frame_y) = menu_frame_insets(view);
        (
            placement.item_width.unwrap_or(84.0) + 2.0 * frame_x,
            placement.item_height.unwrap_or(36.0) + 2.0 * frame_y,
        )
    } else {
        menu_total_size(view, placement)
    }
}

/// Geometry for a detached menu surface. Collapsing keeps the MenuFold at
/// its absolute expanded position.
pub fn free_menu_geometry_for_state(
    view: &MenuView,
    placement: &MenuPlacement,
    free_position: Option<FreePosition>,
    collapsed: bool,
) -> ComputedMenuGeometry {
    let (width, height) = menu_total_size_for_state(view, placement, collapsed);
    let (mut x, mut y) = free_position
        .map(|position| (position.x, position.y))
        .unwrap_or((0.0, 0.0));
    if collapsed && free_position.is_some() {
        let (toggle_x, toggle_y) = menu_toggle_position(view, placement);
        x += toggle_x;
        y += toggle_y;
    }
    ComputedMenuGeometry {
        x,
        y,
        width,
        height,
    }
}

/// Position of the MenuFold button inside the full menu grid.
pub fn menu_toggle_position(view: &MenuView, placement: &MenuPlacement) -> (f64, f64) {
    let Some(index) = view.items.iter().position(|item| matches!(item, LayoutEntry::MenuFold { .. })) else {
        return (0.0, 0.0);
    };
    let factor = (0..index).map(|i| 1.0 + menu_gap_ratio_after(view, i)).sum::<f64>();
    match view.orientation {
        MenuOrientation::Row => (factor * placement.item_width.unwrap_or(84.0), 0.0),
        MenuOrientation::Column => (0.0, factor * placement.item_height.unwrap_or(36.0)),
    }
}

/// Derives the full window geometry (x, y, width, height) relative to the browser window.
pub fn compute_menu_geometry(
    window: &BrowserWindowSnapshot,
    view: &MenuView,
    placement: &MenuPlacement,
) -> ComputedMenuGeometry {
    compute_menu_geometry_for_state(window, view, placement, false)
}

/// Derives geometry for the menu's current state. In the collapsed state, the
/// MenuFold keeps the absolute position it occupies in the full menu, so
/// right/bottom anchors must first resolve against the full-menu size.
pub fn compute_menu_geometry_for_state(
    window: &BrowserWindowSnapshot,
    view: &MenuView,
    placement: &MenuPlacement,
    collapsed: bool,
) -> ComputedMenuGeometry {
    let (full_width, full_height) = menu_total_size(view, placement);
    let (width, height) = menu_total_size_for_state(view, placement, collapsed);
    let (toggle_x, toggle_y) = menu_toggle_position(view, placement);
    let bounds = &window.bounds;
    let bound = &placement.bound_position;
    let full_x = match bound.anchor {
        MenuAnchor::TopLeft | MenuAnchor::BottomLeft => bounds.x + bound.offset_x,
        MenuAnchor::TopRight | MenuAnchor::BottomRight => {
            bounds.x + bounds.width - full_width - bound.offset_x
        }
    };
    let full_y = match bound.anchor {
        MenuAnchor::TopLeft | MenuAnchor::TopRight => bounds.y + bound.offset_y,
        MenuAnchor::BottomLeft | MenuAnchor::BottomRight => {
            bounds.y + bounds.height - full_height - bound.offset_y
        }
    };
    let x = full_x + if collapsed { toggle_x } else { 0.0 };
    let y = full_y + if collapsed { toggle_y } else { 0.0 };
    ComputedMenuGeometry {
        x,
        y,
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BrowserWindowSnapshot, ExtensionMessage, LayoutEntry, MenuPlacement, MenuView, NativeMessage,
        SyncedMenu, compute_menu_geometry_for_state, free_menu_geometry_for_state,
    };

    #[test]
    fn preserves_temporary_bookmark_action_without_its_url() {
        let entry: LayoutEntry = serde_json::from_str(
            r#"{"kind":"bookmark","uid":"temporary:slot","label":"Later"}"#,
        )
        .unwrap();
        let encoded = serde_json::to_value(entry).unwrap();
        assert_eq!(encoded["uid"], "temporary:slot");
        assert!(encoded.get("url").is_none());
    }

    #[test]
    fn reads_the_extension_hello_contract() {
        let message = serde_json::from_str::<ExtensionMessage>(
            r#"{"type":"hello","protocolVersion":1,"instance":{"uid":"instance-a","browser":"chrome","label":"Work"}}"#,
        )
        .unwrap();

        assert!(matches!(
            message,
            ExtensionMessage::Hello {
                protocol_version: 1,
                instance,
                ..
            } if instance.uid == "instance-a"
        ));
    }

    #[test]
    fn handles_unknown_message_types_gracefully() {
        let message = serde_json::from_str::<ExtensionMessage>(
            r#"{"type":"someNewFutureMessage","payload":123}"#,
        )
        .unwrap();
        assert!(matches!(message, ExtensionMessage::Unknown));
    }

    #[test]
    fn handles_backward_and_forward_compatibility_in_sync() {
        // Sync payload with:
        // - onTopMode fallback to aboveBrowser when unknown string
        // - unknown future attachmentMode
        // - empty string expandDirection
        // - unknown entry kind in items
        // - unknown menu orientation
        let json = r#"{
            "type": "sync",
            "revision": 1,
            "menus": [{
                "view": {
                    "uid": "menu-1",
                    "orientation": "diagonalFuture",
                    "expandDirection": "",
                    "items": [
                        { "kind": "bookmark", "uid": "b1", "label": "Google" },
                        { "kind": "customWidget", "uid": "w1", "extra": true }
                    ]
                },
                "placement": {
                    "boundPosition": { "anchor": "centerFuture" }
                },
                "native": {
                    "attachmentMode": "futureAttachmentStrategy",
                    "onTopMode": "unknownFutureMode"
                },
                "target": {
                    "kind": "window",
                    "window": {
                        "uid": "win-1",
                        "bounds": { "x": 0, "y": 0, "width": 800, "height": 600 }
                    }
                }
            }]
        }"#;

        let message =
            serde_json::from_str::<ExtensionMessage>(json).expect("should parse resiliently");
        if let ExtensionMessage::Sync { menus, .. } = message {
            assert_eq!(menus.len(), 1);
            let menu = &menus[0];
            assert_eq!(menu.view.orientation, super::MenuOrientation::Row);
            assert_eq!(
                menu.placement.bound_position.anchor,
                super::MenuAnchor::TopLeft
            );
            assert_eq!(menu.native.attachment_mode, super::AttachmentMode::LastFocused);
            assert_eq!(menu.native.on_top_mode, super::OnTopMode::AboveBrowser);
            assert_eq!(menu.view.expand_direction, None);
            assert_eq!(menu.view.items.len(), 2);
            assert!(matches!(menu.view.items[1], super::LayoutEntry::Unknown));
        } else {
            panic!("Expected ExtensionMessage::Sync");
        }
    }

    #[test]
    fn reads_bound_and_free_menus_from_one_sync_collection() {
        let message = serde_json::from_str::<ExtensionMessage>(
            r#"{
                "type": "sync",
                "revision": 1,
                "menus": [
                    {
                        "view": { "uid": "bound-menu", "orientation": "row", "items": [] },
                        "placement": { "boundPosition": { "anchor": "topLeft", "offsetX": 0, "offsetY": 0 } },
                        "native": { "attachmentMode": "lastFocused", "onTopMode": "aboveBrowser", "visible": true },
                        "target": {
                            "kind": "window",
                            "window": {
                                "uid": "window-a",
                                "bounds": { "x": 0, "y": 0, "width": 800, "height": 600 }
                            }
                        }
                    },
                    {
                        "view": { "uid": "free-menu", "orientation": "column", "items": [] },
                        "placement": {
                            "boundPosition": { "anchor": "topLeft", "offsetX": 0, "offsetY": 0 },
                            "freePosition": { "x": 120, "y": 240 }
                        },
                        "native": { "attachmentMode": "free", "onTopMode": "alwaysOnTop", "visible": true },
                        "target": { "kind": "free" }
                    }
                ]
            }"#,
        )
        .unwrap();

        let ExtensionMessage::Sync { menus, .. } = message else {
            panic!("Expected ExtensionMessage::Sync");
        };
        assert_eq!(menus.len(), 2);
        assert_eq!(
            menus[0].bound_window().map(|window| window.uid.as_str()),
            Some("window-a")
        );
        assert!(menus[1].is_free());
        assert_eq!(
            menus[1]
                .free_position()
                .map(|position| (position.x, position.y)),
            Some((120.0, 240.0))
        );
    }

    #[test]
    fn reads_negative_popup_expansion_directions() {
        let left: MenuView = serde_json::from_str(
            r#"{
                "uid": "menu-left",
                "orientation": "column",
                "expandDirection": "left",
                "items": []
            }"#,
        )
        .unwrap();
        let up: MenuView = serde_json::from_str(
            r#"{
                "uid": "menu-up",
                "orientation": "row",
                "expandDirection": "up",
                "items": []
            }"#,
        )
        .unwrap();

        assert_eq!(left.expand_direction, Some(super::ExpandDirection::Left));
        assert_eq!(up.expand_direction, Some(super::ExpandDirection::Up));
    }

    #[test]
    fn relays_popup_alignment_to_the_menu_webview() {
        for alignment in ["edge", "center"] {
            let view: MenuView = serde_json::from_value(serde_json::json!({
                "uid": "menu",
                "expandAlignment": alignment,
                "items": []
            }))
            .unwrap();
            assert_eq!(
                serde_json::to_value(view).unwrap()["expandAlignment"],
                alignment
            );
        }
    }

    #[test]
    fn writes_an_invocation_with_the_required_window_context() {
        let message = NativeMessage::Invoke {
            action_uid: "bookmark:same".into(),
            window_uid: Some("window-a".into()),
            menu_uid: None,
        };

        assert_eq!(
            serde_json::to_value(message).unwrap(),
            serde_json::json!({
                "type": "invoke",
                "actionUid": "bookmark:same",
                "windowUid": "window-a"
            })
        );
    }

    #[test]
    fn writes_a_free_invocation_without_a_window() {
        let message = NativeMessage::Invoke {
            action_uid: "bookmark:same".into(),
            window_uid: None,
            menu_uid: Some("menu-1".into()),
        };

        assert_eq!(
            serde_json::to_value(message).unwrap(),
            serde_json::json!({
                "type": "invoke",
                "actionUid": "bookmark:same",
                "menuUid": "menu-1"
            })
        );
    }

    #[test]
    fn collapsed_menu_keeps_the_toggle_button_at_its_expanded_position() {
        let view: MenuView = serde_json::from_str(
            r#"{
                "uid": "menu-1",
                "orientation": "row",
                "gapRatio": 0.1,
                "extraGaps": { "a": 0.2, "e": 3 },
                "items": [
                    { "kind": "bookmark", "uid": "a", "label": "A" },
                    { "kind": "bookmark", "uid": "b", "label": "B" },
                    { "kind": "menuFold", "uid": "toggle", "label": "D" },
                    { "kind": "bookmark", "uid": "e", "label": "E" }
                ]
            }"#,
        )
        .unwrap();
        let view: MenuView = serde_json::from_value(serde_json::to_value(view).unwrap()).unwrap();
        let placement: MenuPlacement = serde_json::from_str(
            r#"{
                "boundPosition": { "anchor": "topRight", "offsetX": 10 },
                "itemWidth": 50,
                "itemHeight": 20
            }"#,
        )
        .unwrap();
        let window = BrowserWindowSnapshot {
            uid: "window-a".into(),
            bounds: crate::protocol::WindowBounds {
                x: 0.0,
                y: 0.0,
                width: 1000.0,
                height: 600.0,
            },
            focused: true,
        };

        let expanded = compute_menu_geometry_for_state(&window, &view, &placement, false);
        let collapsed = compute_menu_geometry_for_state(&window, &view, &placement, true);

        assert_eq!((expanded.x + 120.0, expanded.y), (collapsed.x, collapsed.y));
        assert_eq!(expanded.width, 235.0);
        assert_eq!((collapsed.width, collapsed.height), (60.0, 22.0));
    }

    #[test]
    fn collapsed_free_menu_keeps_the_toggle_button_at_its_expanded_position() {
        let menu_json = r#"{
            "view": {
                "uid": "menu-free",
                "orientation": "row",
                "gapRatio": 0.1,
                "items": [
                    { "kind": "bookmark", "uid": "a", "label": "A" },
                    { "kind": "menuFold", "uid": "toggle", "label": "D" }
                ]
            },
            "placement": {
                "itemWidth": 50,
                "itemHeight": 20,
                "freePosition": { "x": 100, "y": 200 }
            },
            "native": { "attachmentMode": "free", "onTopMode": "alwaysOnTop", "visible": true },
            "target": { "kind": "free" }
        }"#;
        let synced: SyncedMenu = serde_json::from_str(menu_json).unwrap();

        let expanded =
            free_menu_geometry_for_state(&synced.view, &synced.placement, synced.free_position(), false);
        let collapsed =
            free_menu_geometry_for_state(&synced.view, &synced.placement, synced.free_position(), true);

        assert_eq!((expanded.width, expanded.height), (115.0, 22.0));
        assert_eq!((expanded.x + 55.0, expanded.y), (collapsed.x, collapsed.y));
        assert_eq!((collapsed.width, collapsed.height), (60.0, 22.0));
    }

    #[test]
    fn preserves_color_alpha_when_forwarding_menu_views() {
        let json = r##"{
            "uid": "menu-custom",
            "dockColor": "#ff000080",
            "items": [
                { "kind": "menuFold", "uid": "toggle-1", "label": "Toggle", "color": "#00ff0000" }
            ]
        }"##;
        let view: MenuView = serde_json::from_str(json).unwrap();
        assert_eq!(view.dock_color.as_deref(), Some("#ff000080"));
        let forwarded = serde_json::to_value(&view).unwrap();
        assert_eq!(forwarded["dockColor"], "#ff000080");
        assert_eq!(forwarded["items"][0]["color"], "#00ff0000");
        match &view.items[0] {
            LayoutEntry::MenuFold { color, .. } => {
                assert_eq!(color.as_deref(), Some("#00ff0000"));
            }
            _ => panic!("Expected MenuFold"),
        }
    }

    #[test]
    fn preserves_action_buttons_when_forwarding_menu_views_to_the_webview() {
        let view: MenuView = serde_json::from_value(serde_json::json!({
            "uid": "actions",
            "items": [
                { "kind": "browserAction", "uid": "browserAction:back", "label": "Back" },
                { "kind": "menusToggle", "uid": "menusToggle:others", "label": "Menus" },
                { "kind": "menuFold", "uid": "fold", "label": "Fold" }
            ]
        }))
        .unwrap();
        let forwarded = serde_json::to_value(view).unwrap();
        assert_eq!(forwarded["items"][0]["kind"], "browserAction");
        assert_eq!(forwarded["items"][0]["label"], "Back");
        assert_eq!(forwarded["items"][1]["kind"], "menusToggle");
        assert_eq!(forwarded["items"][1]["uid"], "menusToggle:others");
        assert_eq!(forwarded["items"][2]["kind"], "menuFold");
    }
}
