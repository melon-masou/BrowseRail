use std::collections::HashMap;
use std::sync::RwLock;

use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::protocol::{
    AttachmentMode, BrowserInstance, FreePosition, MenuPlacement, MenuSnapshot, PanelSnapshot,
    ServerMessage,
};

#[derive(Default)]
pub struct SessionRegistry {
    sessions: RwLock<HashMap<String, Session>>,
}

struct Session {
    connection_uid: Option<Uuid>,
    instance: BrowserInstance,
    outgoing: Option<UnboundedSender<ServerMessage>>,
    panels: HashMap<String, PanelSnapshot>,
    // Free (detached) menu snapshots, keyed by menuUid. Stored like panels so a
    // free surface can fetch its own snapshot via free_surface_state — the only
    // difference from a bound menu is that there is no window key.
    free_menus: HashMap<String, MenuSnapshot>,
    attachment_mode: AttachmentMode,
    revision: u64,
}

pub struct SyncOutcome {
    pub instance_uid: String,
    pub attachment_mode: AttachmentMode,
    pub panels: Vec<PanelSnapshot>,
    pub removed_window_uids: Vec<String>,
    pub free_menus: Vec<MenuSnapshot>,
}

pub struct InstancePanelsSnapshot {
    pub attachment_mode: AttachmentMode,
    pub browser: Option<String>,
    pub instance_uid: String,
    pub panels: Vec<PanelSnapshot>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedExtension {
    pub instance_uid: String,
    pub browser: Option<String>,
    pub label: Option<String>,
    pub windows_count: usize,
}

impl SessionRegistry {
    pub fn register(
        &self,
        connection_uid: Uuid,
        instance: BrowserInstance,
        outgoing: UnboundedSender<ServerMessage>,
    ) {
        let mut sessions = self.sessions.write().expect("session lock poisoned");
        if let Some(session) = sessions.get_mut(&instance.uid) {
            session.connection_uid = Some(connection_uid);
            session.instance = instance;
            session.outgoing = Some(outgoing);
            session.revision = 0;
        } else {
            sessions.insert(
                instance.uid.clone(),
                Session {
                    connection_uid: Some(connection_uid),
                    instance,
                    outgoing: Some(outgoing),
                    panels: HashMap::new(),
                    free_menus: HashMap::new(),
                    attachment_mode: AttachmentMode::None,
                    revision: 0,
                },
            );
        }
    }

    pub fn sync(
        &self,
        connection_uid: Uuid,
        revision: u64,
        attachment_mode: AttachmentMode,
        panels: Vec<PanelSnapshot>,
        free_menus: Vec<MenuSnapshot>,
    ) -> Result<Option<SyncOutcome>, String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .values_mut()
            .find(|session| session.connection_uid == Some(connection_uid))
            .ok_or("The connection has not registered an instance")?;

        if revision <= session.revision {
            return Ok(None);
        }

        let next = panels
            .iter()
            .map(|panel| (panel.window.uid.clone(), panel.clone()))
            .collect::<HashMap<_, _>>();
        let removed_window_uids = session
            .panels
            .keys()
            .filter(|uid| !next.contains_key(*uid))
            .cloned()
            .collect();
        session.panels = next;
        session.free_menus = free_menus
            .iter()
            .map(|menu| (menu.uid.clone(), menu.clone()))
            .collect();
        session.attachment_mode = attachment_mode;
        session.revision = revision;

        Ok(Some(SyncOutcome {
            instance_uid: session.instance.uid.clone(),
            attachment_mode,
            panels,
            removed_window_uids,
            free_menus,
        }))
    }

    /// The stored snapshot for a free (detached) menu, for free_surface_state.
    pub fn free_menu(&self, instance_uid: &str, menu_uid: &str) -> Option<MenuSnapshot> {
        self.sessions
            .read()
            .ok()?
            .get(instance_uid)?
            .free_menus
            .get(menu_uid)
            .cloned()
    }

    pub fn invoke(
        &self,
        instance_uid: &str,
        window_uid: &str,
        action_uid: String,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get(instance_uid)
            .ok_or("The browser instance is disconnected")?;
        if !session.panels.contains_key(window_uid) {
            return Err("The bound browser window is unavailable".into());
        }

        session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?
            .send(ServerMessage::Invoke {
                action_uid,
                window_uid: Some(window_uid.to_owned()),
                menu_uid: None,
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    /// Dispatch a free (detached) surface's action. No fixed target window is
    /// sent: the extension resolves the target as its current lastFocused
    /// window. Does not require any bound window to exist.
    pub fn invoke_free(
        &self,
        instance_uid: &str,
        menu_uid: String,
        action_uid: String,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get(instance_uid)
            .ok_or("The browser instance is disconnected")?;
        session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?
            .send(ServerMessage::Invoke {
                action_uid,
                window_uid: None,
                menu_uid: Some(menu_uid),
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    /// Report a free surface's new absolute screen position back to the
    /// extension for persistence.
    pub fn update_free_placement(
        &self,
        instance_uid: &str,
        menu_uid: String,
        x: f64,
        y: f64,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get_mut(instance_uid)
            .ok_or("The browser instance is disconnected")?;

        if let Some(menu) = session.free_menus.get_mut(&menu_uid) {
            menu.free_position = Some(FreePosition { x, y });
        }

        session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?
            .send(ServerMessage::UpdateFreePlacement { menu_uid, x, y })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    pub fn panel(&self, instance_uid: &str, window_uid: &str) -> Option<PanelSnapshot> {
        self.sessions
            .read()
            .ok()?
            .get(instance_uid)?
            .panels
            .get(window_uid)
            .cloned()
    }

    pub fn panel_context(
        &self,
        instance_uid: &str,
        window_uid: &str,
    ) -> Option<(AttachmentMode, PanelSnapshot)> {
        let sessions = self.sessions.read().ok()?;
        let session = sessions.get(instance_uid)?;
        Some((
            session.attachment_mode,
            session.panels.get(window_uid)?.clone(),
        ))
    }

    pub fn panel_snapshots(&self) -> Vec<(String, AttachmentMode, Vec<PanelSnapshot>)> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(instance_uid, session)| {
                        (
                            instance_uid.clone(),
                            session.attachment_mode,
                            session.panels.values().cloned().collect(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn instance_panel_snapshots(&self) -> Vec<InstancePanelsSnapshot> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(instance_uid, session)| InstancePanelsSnapshot {
                        attachment_mode: session.attachment_mode,
                        browser: session.instance.browser.clone(),
                        instance_uid: instance_uid.clone(),
                        panels: session.panels.values().cloned().collect(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn browser_kind(&self, instance_uid: &str) -> Option<String> {
        self.sessions
            .read()
            .ok()?
            .get(instance_uid)?
            .instance
            .browser
            .clone()
    }

    pub fn update_menu_placement(
        &self,
        instance_uid: &str,
        menu_uid: String,
        placement: MenuPlacement,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get_mut(instance_uid)
            .ok_or("The browser instance is disconnected")?;

        // A menu can appear both as bound panels and as a free (detached)
        // surface; keep the stored free snapshot in sync so an endpoint save can
        // fall back to the preserved global placement for its offsets/anchor.
        if let Some(menu) = session.free_menus.get_mut(&menu_uid) {
            menu.placement.item_width = placement.item_width;
            menu.placement.item_height = placement.item_height;
        }

        for panel in session.panels.values_mut() {
            for menu in &mut panel.menus {
                if menu.uid == menu_uid {
                    menu.placement = placement.clone();
                }
            }
        }

        let outgoing = session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?;
        outgoing
            .send(ServerMessage::UpdateMenuPlacement {
                menu_uid,
                placement,
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    pub fn disconnect(&self, connection_uid: Uuid) -> Option<(String, Vec<String>)> {
        let mut sessions = self.sessions.write().ok()?;
        let session = sessions
            .values_mut()
            .find(|session| session.connection_uid == Some(connection_uid))?;
        session.connection_uid = None;
        session.outgoing = None;
        Some((
            session.instance.uid.clone(),
            session.panels.keys().cloned().collect(),
        ))
    }

    pub fn disconnect_all(&self) -> Vec<(String, Vec<String>)> {
        self.sessions
            .write()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(instance_uid, session)| {
                        (instance_uid, session.panels.into_keys().collect())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn active_instances(&self) -> Vec<String> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .values()
                    .filter(|s| s.outgoing.is_some())
                    .map(|s| {
                        s.instance
                            .label
                            .as_deref()
                            .filter(|l| !l.is_empty())
                            .unwrap_or(&s.instance.uid)
                            .to_string()
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn active_extensions(&self) -> Vec<ConnectedExtension> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .values()
                    .filter(|s| s.outgoing.is_some())
                    .map(|s| ConnectedExtension {
                        instance_uid: s.instance.uid.clone(),
                        browser: s.instance.browser.clone(),
                        label: s.instance.label.clone(),
                        windows_count: s.panels.len(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc::unbounded_channel;
    use uuid::Uuid;

    use super::SessionRegistry;
    use crate::protocol::{
        AttachmentMode, BrowserInstance, BrowserWindowSnapshot, PanelSnapshot, ServerMessage,
        WindowBounds,
    };

    #[test]
    fn routes_identical_actions_to_the_exact_instance_and_window() {
        let registry = SessionRegistry::default();
        let connection_a = Uuid::new_v4();
        let connection_b = Uuid::new_v4();
        let (sender_a, mut receiver_a) = unbounded_channel();
        let (sender_b, mut receiver_b) = unbounded_channel();

        registry.register(connection_a, instance("instance-a"), sender_a);
        registry.register(connection_b, instance("instance-b"), sender_b);
        registry
            .sync(
                connection_a,
                1,
                AttachmentMode::All,
                vec![panel("window-a")], vec![],
            )
            .unwrap();
        registry
            .sync(
                connection_b,
                1,
                AttachmentMode::All,
                vec![panel("window-b")], vec![],
            )
            .unwrap();

        registry
            .invoke("instance-a", "window-a", "bookmark:same".into())
            .unwrap();

        let message = receiver_a.try_recv().unwrap();
        assert!(matches!(
            message,
            ServerMessage::Invoke { window_uid, action_uid, .. }
                if window_uid.as_deref() == Some("window-a") && action_uid == "bookmark:same"
        ));
        assert!(receiver_b.try_recv().is_err());
    }

    #[test]
    fn rejects_a_window_owned_by_another_instance() {
        let registry = SessionRegistry::default();
        let connection_a = Uuid::new_v4();
        let connection_b = Uuid::new_v4();
        let (sender_a, mut receiver_a) = unbounded_channel();
        let (sender_b, mut receiver_b) = unbounded_channel();

        registry.register(connection_a, instance("instance-a"), sender_a);
        registry.register(connection_b, instance("instance-b"), sender_b);
        registry
            .sync(
                connection_a,
                1,
                AttachmentMode::All,
                vec![panel("window-a")], vec![],
            )
            .unwrap();
        registry
            .sync(
                connection_b,
                1,
                AttachmentMode::All,
                vec![panel("window-b")], vec![],
            )
            .unwrap();

        let result = registry.invoke("instance-a", "window-b", "bookmark:same".into());

        assert_eq!(
            result.unwrap_err(),
            "The bound browser window is unavailable"
        );
        assert!(receiver_a.try_recv().is_err());
        assert!(receiver_b.try_recv().is_err());
    }

    #[test]
    fn disconnecting_all_instances_removes_their_panels_and_routes() {
        let registry = SessionRegistry::default();
        let connection = Uuid::new_v4();
        let (sender, _) = unbounded_channel();
        registry.register(connection, instance("instance-a"), sender);
        registry
            .sync(connection, 1, AttachmentMode::All, vec![panel("window-a")], vec![])
            .unwrap();

        let disconnected = registry.disconnect_all();

        assert_eq!(disconnected.len(), 1);
        assert_eq!(disconnected[0].0, "instance-a");
        assert_eq!(disconnected[0].1, vec!["window-a"]);
        assert!(registry.panel("instance-a", "window-a").is_none());
    }

    #[test]
    fn replacing_a_connection_keeps_its_panels_for_the_first_new_sync() {
        let registry = SessionRegistry::default();
        let old_connection = Uuid::new_v4();
        let new_connection = Uuid::new_v4();
        let (old_sender, _old_receiver) = unbounded_channel();
        let (new_sender, _new_receiver) = unbounded_channel();

        registry.register(old_connection, instance("instance-a"), old_sender);
        registry
            .sync(
                old_connection,
                1,
                AttachmentMode::All,
                vec![panel("window-a")], vec![],
            )
            .unwrap();

        registry.register(new_connection, instance("instance-a"), new_sender);

        assert!(registry.disconnect(old_connection).is_none());
        let outcome = registry
            .sync(
                new_connection,
                1,
                AttachmentMode::All,
                vec![panel("window-b")], vec![],
            )
            .unwrap()
            .expect("sync outcome");
        assert_eq!(outcome.removed_window_uids, vec!["window-a"]);
        assert!(registry.panel("instance-a", "window-b").is_some());
    }

    #[test]
    fn disconnecting_then_reconnecting_keeps_panels_for_next_sync() {
        let registry = SessionRegistry::default();
        let old_connection = Uuid::new_v4();
        let new_connection = Uuid::new_v4();
        let (old_sender, _old_receiver) = unbounded_channel();
        let (new_sender, _new_receiver) = unbounded_channel();

        registry.register(old_connection, instance("instance-a"), old_sender);
        registry
            .sync(
                old_connection,
                1,
                AttachmentMode::All,
                vec![panel("window-a")], vec![],
            )
            .unwrap();

        let disconnected = registry.disconnect(old_connection);
        assert_eq!(
            disconnected,
            Some(("instance-a".into(), vec!["window-a".into()]))
        );
        assert!(registry.panel("instance-a", "window-a").is_some());

        registry.register(new_connection, instance("instance-a"), new_sender);
        let outcome = registry
            .sync(
                new_connection,
                1,
                AttachmentMode::All,
                vec![panel("window-b")], vec![],
            )
            .unwrap()
            .expect("sync outcome");
        assert_eq!(outcome.removed_window_uids, vec!["window-a"]);
        assert!(registry.panel("instance-a", "window-b").is_some());
    }

    #[test]
    fn ignores_stale_sync_revisions() {
        let registry = SessionRegistry::default();
        let connection = Uuid::new_v4();
        let (sender, _) = unbounded_channel();
        registry.register(connection, instance("instance-a"), sender);
        assert!(
            registry
                .sync(connection, 2, AttachmentMode::All, vec![panel("window-a")], vec![])
                .unwrap()
                .is_some()
        );
        assert!(
            registry
                .sync(connection, 2, AttachmentMode::All, vec![panel("window-a")], vec![])
                .unwrap()
                .is_none()
        );
        assert!(
            registry
                .sync(connection, 1, AttachmentMode::All, vec![panel("window-a")], vec![])
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn tracks_active_extensions_with_window_counts() {
        let registry = SessionRegistry::default();
        let connection_a = Uuid::new_v4();
        let connection_b = Uuid::new_v4();
        let (sender_a, _) = unbounded_channel();
        let (sender_b, _) = unbounded_channel();

        let inst_a = BrowserInstance {
            uid: "instance-a".into(),
            browser: Some("chrome".into()),
            label: Some("Work Profile".into()),
        };
        let inst_b = BrowserInstance {
            uid: "instance-b".into(),
            browser: Some("edge".into()),
            label: None,
        };

        registry.register(connection_a, inst_a, sender_a);
        registry.register(connection_b, inst_b, sender_b);
        let _ = registry.sync(
            connection_a,
            1,
            AttachmentMode::All,
            vec![panel("window-1"), panel("window-2")], vec![],
        );

        let exts = registry.active_extensions();
        assert_eq!(exts.len(), 2);
        let ext_a = exts.iter().find(|e| e.instance_uid == "instance-a").unwrap();
        assert_eq!(ext_a.browser.as_deref(), Some("chrome"));
        assert_eq!(ext_a.label.as_deref(), Some("Work Profile"));
        assert_eq!(ext_a.windows_count, 2);

        let ext_b = exts.iter().find(|e| e.instance_uid == "instance-b").unwrap();
        assert_eq!(ext_b.browser.as_deref(), Some("edge"));
        assert_eq!(ext_b.label, None);
        assert_eq!(ext_b.windows_count, 0);

        registry.disconnect(connection_b);
        let exts_after = registry.active_extensions();
        assert_eq!(exts_after.len(), 1);
        assert_eq!(exts_after[0].instance_uid, "instance-a");
    }

    fn instance(uid: &str) -> BrowserInstance {
        BrowserInstance {
            uid: uid.into(),
            browser: None,
            label: None,
        }
    }

    fn panel(window_uid: &str) -> PanelSnapshot {
        PanelSnapshot {
            on_top_mode: crate::protocol::OnTopMode::AboveBrowser,
            menus: vec![],
            window: BrowserWindowSnapshot {
                uid: window_uid.into(),
                bounds: WindowBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 1200.0,
                    height: 800.0,
                },
                focused: true,
            },
        }
    }
}
