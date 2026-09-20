use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(rename = "protocolVersion")]
        protocol_version: u16,
        instance: BrowserInstance,
    },
    #[serde(rename = "sync")]
    Sync {
        revision: u64,
        #[serde(default, rename = "attachmentMode")]
        attachment_mode: AttachmentMode,
        panels: Vec<PanelSnapshot>,
        #[serde(default, rename = "freeMenus")]
        free_menus: Vec<MenuSnapshot>,
        #[serde(default, rename = "resetMenuUids")]
        reset_menu_uids: Vec<String>,
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
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
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
    #[serde(rename = "updateMenuPlacement")]
    UpdateMenuPlacement {
        #[serde(rename = "menuUid")]
        menu_uid: String,
        placement: MenuPlacement,
    },
    #[serde(rename = "updateFreePlacement")]
    UpdateFreePlacement {
        #[serde(rename = "menuUid")]
        menu_uid: String,
        x: f64,
        y: f64,
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
    #[allow(dead_code)]
    #[serde(default)]
    pub browser: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentMode {
    None,
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
            "none" => Ok(AttachmentMode::None),
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSnapshot {
    #[serde(default)]
    pub on_top_mode: OnTopMode,
    #[serde(default)]
    pub menus: Vec<MenuSnapshot>,
    pub window: BrowserWindowSnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSnapshot {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub font_size: Option<serde_json::Value>,
    #[serde(default)]
    pub gap: Option<f64>,
    #[serde(default)]
    pub button_padding: Option<f64>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_expand_direction")]
    pub expand_direction: Option<ExpandDirection>,
    #[serde(default)]
    pub items: Vec<LayoutEntry>,
    #[serde(default)]
    pub orientation: MenuOrientation,
    #[serde(default)]
    pub attachment_mode: AttachmentMode,
    #[serde(default)]
    pub on_top_mode: OnTopMode,
    pub placement: MenuPlacement,
    pub uid: String,
    // Absolute screen coordinates for a free menu's floating surface; absent
    // means "no saved position, center on the primary monitor".
    #[serde(default, rename = "freePosition")]
    pub free_position: Option<FreePosition>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuPlacement {
    #[serde(default)]
    pub anchor: MenuAnchor,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    #[serde(default)]
    pub item_width: Option<f64>,
    #[serde(default)]
    pub item_height: Option<f64>,
    #[serde(default)]
    pub font_size: Option<serde_json::Value>,
    #[serde(default)]
    pub gap: Option<f64>,
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
    MenuToggle {
        uid: String,
        label: String,
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
    Space {
        uid: String,
        #[serde(default)]
        units: Option<f64>,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        transparent: Option<bool>,
    },
    #[serde(other)]
    Unknown,
}

/// Number of grid tracks the menu bar renders, matching the frontend exactly
/// (apps/desktop/src/main.ts `totalUnits`): space items span `units` tracks
/// (min 0.1), every other item spans 1, then the sum is rounded to whole
/// tracks. Both the resize->item-size derivation and the item-size->total
/// recompute must use this same count (and the same gap) so they stay exact
/// inverses; otherwise a plain save round-trips into a growing menu size.
pub fn menu_track_count(items: &[LayoutEntry]) -> f64 {
    let total_units: f64 = items
        .iter()
        .map(|item| match item {
            LayoutEntry::Space { units, .. } => units.unwrap_or(1.0).max(0.1),
            _ => 1.0,
        })
        .sum();
    total_units.round().max(1.0)
}

/// Gap in px between menu tracks, resolved identically to the frontend
/// (apps/desktop/src/main.ts): the placement gap, else the snapshot gap,
/// else 4. Both the resize derivation and the total recompute must use this.
pub fn menu_gap(menu: &MenuSnapshot) -> f64 {
    menu.placement.gap.or(menu.gap).unwrap_or(4.0)
}

/// Derives the internal total window dimensions (width, height) from the menu snapshot.
pub fn menu_total_size(menu: &MenuSnapshot) -> (f64, f64) {
    let count = menu_track_count(&menu.items);
    let item_width = menu.placement.item_width.unwrap_or(84.0);
    let item_height = menu.placement.item_height.unwrap_or(36.0);
    let gap = menu_gap(menu);
    match menu.orientation {
        MenuOrientation::Row => (count * item_width + (count - 1.0) * gap, item_height),
        MenuOrientation::Column => (item_width, count * item_height + (count - 1.0) * gap),
    }
}

pub fn menu_total_size_for_state(menu: &MenuSnapshot, collapsed: bool) -> (f64, f64) {
    if collapsed {
        (
            menu.placement.item_width.unwrap_or(84.0),
            menu.placement.item_height.unwrap_or(36.0),
        )
    } else {
        menu_total_size(menu)
    }
}

/// Geometry for a detached menu surface in its current state. The full state
/// includes the drag handle; the collapsed state places the MenuToggle at its
/// absolute full-state position.
pub fn free_menu_geometry_for_state(menu: &MenuSnapshot, collapsed: bool) -> ComputedMenuGeometry {
    const FREE_DRAG_HANDLE_SIZE: f64 = 10.0;
    let (mut width, mut height) = menu_total_size_for_state(menu, collapsed);
    let Some(position) = menu.free_position else {
        return ComputedMenuGeometry {
            x: 0.0,
            y: 0.0,
            width,
            height,
        };
    };
    let (x, y) = (position.x, position.y);

    if collapsed {
        let (toggle_x, toggle_y) = menu_toggle_position(menu);
        let handle_offset_x = if matches!(menu.orientation, MenuOrientation::Row) {
            FREE_DRAG_HANDLE_SIZE
        } else {
            0.0
        };
        let handle_offset_y = if matches!(menu.orientation, MenuOrientation::Column) {
            FREE_DRAG_HANDLE_SIZE
        } else {
            0.0
        };
        let x = x + handle_offset_x + toggle_x;
        let y = y + handle_offset_y + toggle_y;
        return ComputedMenuGeometry {
            x,
            y,
            width,
            height,
        };
    }

    match menu.orientation {
        MenuOrientation::Row => width += FREE_DRAG_HANDLE_SIZE,
        MenuOrientation::Column => height += FREE_DRAG_HANDLE_SIZE,
    }
    ComputedMenuGeometry {
        x,
        y,
        width,
        height,
    }
}

/// Position of the MenuToggle button inside the full menu grid.
pub fn menu_toggle_position(menu: &MenuSnapshot) -> (f64, f64) {
    let mut units = 0.0;
    for item in &menu.items {
        if matches!(item, LayoutEntry::MenuToggle { .. }) {
            break;
        }
        units += match item {
            LayoutEntry::Space { units: value, .. } => value.unwrap_or(1.0).max(0.1),
            _ => 1.0,
        };
    }

    let track = units.round().max(0.0);
    let gap = menu_gap(menu);
    match menu.orientation {
        MenuOrientation::Row => (
            track * (menu.placement.item_width.unwrap_or(84.0) + gap),
            0.0,
        ),
        MenuOrientation::Column => (
            0.0,
            track * (menu.placement.item_height.unwrap_or(36.0) + gap),
        ),
    }
}

/// Derives the full window geometry (x, y, width, height) relative to the browser window.
pub fn compute_menu_geometry(
    window: &BrowserWindowSnapshot,
    menu: &MenuSnapshot,
) -> ComputedMenuGeometry {
    compute_menu_geometry_for_state(window, menu, false)
}

/// Derives geometry for the menu's current state. In the collapsed state, the
/// MenuToggle keeps the absolute position it occupies in the full menu, so
/// right/bottom anchors must first resolve against the full-menu size.
pub fn compute_menu_geometry_for_state(
    window: &BrowserWindowSnapshot,
    menu: &MenuSnapshot,
    collapsed: bool,
) -> ComputedMenuGeometry {
    let (full_width, full_height) = menu_total_size(menu);
    let (width, height) = menu_total_size_for_state(menu, collapsed);
    let (toggle_x, toggle_y) = menu_toggle_position(menu);
    let bounds = &window.bounds;
    let full_x = match menu.placement.anchor {
        MenuAnchor::TopLeft | MenuAnchor::BottomLeft => bounds.x + menu.placement.offset_x,
        MenuAnchor::TopRight | MenuAnchor::BottomRight => {
            bounds.x + bounds.width - full_width - menu.placement.offset_x
        }
    };
    let full_y = match menu.placement.anchor {
        MenuAnchor::TopLeft | MenuAnchor::TopRight => bounds.y + menu.placement.offset_y,
        MenuAnchor::BottomLeft | MenuAnchor::BottomRight => {
            bounds.y + bounds.height - full_height - menu.placement.offset_y
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
        BrowserWindowSnapshot, ClientMessage, MenuSnapshot, ServerMessage,
        compute_menu_geometry_for_state, free_menu_geometry_for_state,
    };

    #[test]
    fn reads_the_extension_hello_contract() {
        let message = serde_json::from_str::<ClientMessage>(
            r#"{"type":"hello","protocolVersion":1,"instance":{"uid":"instance-a","browser":"chrome","label":"Work"}}"#,
        )
        .unwrap();

        assert!(matches!(
            message,
            ClientMessage::Hello {
                protocol_version: 1,
                instance,
                ..
            } if instance.uid == "instance-a"
        ));
    }

    #[test]
    fn handles_unknown_message_types_gracefully() {
        let message = serde_json::from_str::<ClientMessage>(
            r#"{"type":"someNewFutureMessage","payload":123}"#,
        )
        .unwrap();
        assert!(matches!(message, ClientMessage::Unknown));
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
            "attachmentMode": "futureAttachmentStrategy",
            "panels": [{
                "onTopMode": "unknownFutureMode",
                "menus": [{
                    "uid": "menu-1",
                    "orientation": "diagonalFuture",
                    "placement": {
                        "anchor": "centerFuture",
                        "width": 100,
                        "height": 40
                    },
                    "expandDirection": "",
                    "items": [
                        { "kind": "bookmark", "uid": "b1", "label": "Google" },
                        { "kind": "customWidget", "uid": "w1", "extra": true }
                    ]
                }],
                "window": {
                    "uid": "win-1",
                    "bounds": { "x": 0, "y": 0, "width": 800, "height": 600 }
                }
            }]
        }"#;

        let message =
            serde_json::from_str::<ClientMessage>(json).expect("should parse resiliently");
        if let ClientMessage::Sync {
            attachment_mode,
            panels,
            ..
        } = message
        {
            assert_eq!(attachment_mode, super::AttachmentMode::LastFocused);
            assert_eq!(panels.len(), 1);
            let panel = &panels[0];
            assert_eq!(panel.on_top_mode, super::OnTopMode::AboveBrowser);
            let menu = &panel.menus[0];
            assert_eq!(menu.orientation, super::MenuOrientation::Row);
            assert_eq!(menu.placement.anchor, super::MenuAnchor::TopLeft);
            assert_eq!(menu.expand_direction, None);
            assert_eq!(menu.items.len(), 2);
            assert!(matches!(menu.items[1], super::LayoutEntry::Unknown));
        } else {
            panic!("Expected ClientMessage::Sync");
        }
    }

    #[test]
    fn reads_negative_popup_expansion_directions() {
        let left: MenuSnapshot = serde_json::from_str(
            r#"{
                "uid": "menu-left",
                "orientation": "column",
                "expandDirection": "left",
                "placement": { "anchor": "topLeft", "offsetX": 0, "offsetY": 0 },
                "items": []
            }"#,
        )
        .unwrap();
        let up: MenuSnapshot = serde_json::from_str(
            r#"{
                "uid": "menu-up",
                "orientation": "row",
                "expandDirection": "up",
                "placement": { "anchor": "topLeft", "offsetX": 0, "offsetY": 0 },
                "items": []
            }"#,
        )
        .unwrap();

        assert_eq!(left.expand_direction, Some(super::ExpandDirection::Left));
        assert_eq!(up.expand_direction, Some(super::ExpandDirection::Up));
    }

    #[test]
    fn writes_an_invocation_with_the_required_window_context() {
        let message = ServerMessage::Invoke {
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
        let message = ServerMessage::Invoke {
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
        let menu_json = r#"{
            "uid": "menu-1",
            "orientation": "row",
            "placement": {
                "anchor": "topRight",
                "offsetX": 10,
                "itemWidth": 50,
                "itemHeight": 20,
                "gap": 5
            },
            "items": [
                { "kind": "bookmark", "uid": "a", "label": "A" },
                { "kind": "bookmark", "uid": "b", "label": "B" },
                { "kind": "menuToggle", "uid": "toggle", "label": "D" },
                { "kind": "bookmark", "uid": "e", "label": "E" }
            ]
        }"#;
        let menu: MenuSnapshot = serde_json::from_str(menu_json).unwrap();
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

        let expanded = compute_menu_geometry_for_state(&window, &menu, false);
        let collapsed = compute_menu_geometry_for_state(&window, &menu, true);

        assert_eq!((expanded.x + 110.0, expanded.y), (collapsed.x, collapsed.y));
        assert_eq!((collapsed.width, collapsed.height), (50.0, 20.0));
    }

    #[test]
    fn collapsed_free_menu_keeps_the_toggle_button_at_its_expanded_position() {
        let menu_json = r#"{
            "uid": "menu-free",
            "orientation": "row",
            "freePosition": { "x": 100, "y": 200 },
            "placement": {
                "itemWidth": 50,
                "itemHeight": 20,
                "gap": 5
            },
            "items": [
                { "kind": "bookmark", "uid": "a", "label": "A" },
                { "kind": "menuToggle", "uid": "toggle", "label": "D" }
            ]
        }"#;
        let menu: MenuSnapshot = serde_json::from_str(menu_json).unwrap();

        let expanded = free_menu_geometry_for_state(&menu, false);
        let collapsed = free_menu_geometry_for_state(&menu, true);

        assert_eq!((expanded.x + 65.0, expanded.y), (collapsed.x, collapsed.y));
        assert_eq!((collapsed.width, collapsed.height), (50.0, 20.0));
    }
}
