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
        #[serde(rename = "attachmentMode")]
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
    #[serde(rename = "resync")]
    Resync {
        #[serde(rename = "requestUid")]
        request_uid: String,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat,
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

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentMode {
    None,
    LastFocused,
    All,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSnapshot {
    pub always_on_top: bool,
    pub menus: Vec<MenuSnapshot>,
    pub window: BrowserWindowSnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSnapshot {
    pub items: Vec<LayoutEntry>,
    pub orientation: MenuOrientation,
    pub placement: MenuPlacement,
    pub uid: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MenuOrientation {
    Row,
    Column,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuPlacement {
    pub anchor: MenuAnchor,
    pub height: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub width: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MenuAnchor {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWindowSnapshot {
    pub uid: String,
    pub focused: bool,
    pub state: BrowserWindowState,
    pub bounds: WindowBounds,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BrowserWindowState {
    Normal,
    Minimized,
    Maximized,
    Fullscreen,
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
    },
    Folder {
        uid: String,
        label: String,
        children: Vec<LayoutEntry>,
    },
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
