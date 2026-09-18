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
    },
    #[serde(rename = "actionResult")]
    ActionResult {
        #[serde(rename = "requestUid")]
        request_uid: String,
        ok: bool,
        message: Option<String>,
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
        #[serde(rename = "requestUid")]
        request_uid: String,
        #[serde(rename = "actionUid")]
        action_uid: String,
        #[serde(rename = "windowUid")]
        window_uid: String,
    },
    #[serde(rename = "updateMenuPlacement")]
    UpdateMenuPlacement {
        #[serde(rename = "menuUid")]
        menu_uid: String,
        placement: MenuPlacement,
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
        Some("up") => Ok(Some(ExpandDirection::Up)),
        Some("down") => Ok(Some(ExpandDirection::Down)),
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
    pub font_size: Option<serde_json::Value>,
    #[serde(default)]
    pub gap: Option<f64>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuPlacement {
    #[serde(default)]
    pub anchor: MenuAnchor,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub item_width: Option<f64>,
    #[serde(default)]
    pub item_height: Option<f64>,
    #[serde(default)]
    pub font_size: Option<serde_json::Value>,
    #[serde(default)]
    pub gap: Option<f64>,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResultPayload {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{ClientMessage, ServerMessage};

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

        let message = serde_json::from_str::<ClientMessage>(json).expect("should parse resiliently");
        if let ClientMessage::Sync { attachment_mode, panels, .. } = message {
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
    fn writes_an_invocation_with_the_required_window_context() {
        let message = ServerMessage::Invoke {
            request_uid: "request-a".into(),
            action_uid: "bookmark:same".into(),
            window_uid: "window-a".into(),
        };

        assert_eq!(
            serde_json::to_value(message).unwrap(),
            serde_json::json!({
                "type": "invoke",
                "requestUid": "request-a",
                "actionUid": "bookmark:same",
                "windowUid": "window-a"
            })
        );
    }
}
