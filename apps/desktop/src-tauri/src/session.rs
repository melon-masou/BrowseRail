use std::collections::HashMap;
use std::sync::RwLock;

use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::protocol::{BrowserInstance, MenuPlacement, PanelSnapshot, ServerMessage};

#[derive(Default)]
pub struct SessionRegistry {
    sessions: RwLock<HashMap<String, Session>>,
}

struct Session {
    connection_uid: Option<Uuid>,
    instance: BrowserInstance,
    outgoing: Option<UnboundedSender<ServerMessage>>,
    panels: HashMap<String, PanelSnapshot>,
    pending: HashMap<String, String>,
    revision: u64,
}

pub struct SyncOutcome {
    pub instance_uid: String,
    pub panels: Vec<PanelSnapshot>,
    pub removed_window_uids: Vec<String>,
}

pub struct InstancePanelsSnapshot {
    pub browser: Option<String>,
    pub instance_uid: String,
    pub panels: Vec<PanelSnapshot>,
}

pub struct ResolvedAction {
    pub instance_uid: String,
    pub window_uid: String,
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
            session.pending.clear();
            session.revision = 0;
        } else {
            sessions.insert(
                instance.uid.clone(),
                Session {
                    connection_uid: Some(connection_uid),
                    instance,
                    outgoing: Some(outgoing),
                    panels: HashMap::new(),
                    pending: HashMap::new(),
                    revision: 0,
                },
            );
        }
    }

    pub fn sync(
        &self,
        connection_uid: Uuid,
        revision: u64,
        panels: Vec<PanelSnapshot>,
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
        session.revision = revision;

        Ok(Some(SyncOutcome {
            instance_uid: session.instance.uid.clone(),
            panels,
            removed_window_uids,
        }))
    }

    pub fn invoke(
        &self,
        instance_uid: &str,
        window_uid: &str,
        action_uid: String,
    ) -> Result<String, String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get_mut(instance_uid)
            .ok_or("The browser instance is disconnected")?;
        if !session.panels.contains_key(window_uid) {
            return Err("The bound browser window is unavailable".into());
        }

        let outgoing = session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?;

        let request_uid = Uuid::new_v4().to_string();
        outgoing
            .send(ServerMessage::Invoke {
                request_uid: request_uid.clone(),
                action_uid,
                window_uid: window_uid.to_owned(),
            })
            .map_err(|_| "The browser instance is disconnected")?;
        session
            .pending
            .insert(request_uid.clone(), window_uid.to_owned());
        Ok(request_uid)
    }

    pub fn resolve_action(&self, request_uid: &str) -> Option<ResolvedAction> {
        let mut sessions = self.sessions.write().ok()?;
        sessions.values_mut().find_map(|session| {
            session
                .pending
                .remove(request_uid)
                .map(|window_uid| ResolvedAction {
                    instance_uid: session.instance.uid.clone(),
                    window_uid,
                })
        })
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

    pub fn panel_snapshots(&self) -> Vec<(String, Vec<PanelSnapshot>)> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(instance_uid, session)| {
                        (
                            instance_uid.clone(),
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
                        browser: session.instance.browser.clone(),
                        instance_uid: instance_uid.clone(),
                        panels: session.panels.values().cloned().collect(),
                    })
                    .collect()
            })
            .unwrap_or_default()
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
        session.pending.clear();
        Some((session.instance.uid.clone(), session.panels.keys().cloned().collect()))
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
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc::unbounded_channel;
    use uuid::Uuid;

    use super::SessionRegistry;
    use crate::protocol::{
        BrowserInstance, BrowserWindowSnapshot, BrowserWindowState, PanelSnapshot, ServerMessage,
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
            .sync(connection_a, 1, vec![panel("window-a")])
            .unwrap();
        registry
            .sync(connection_b, 1, vec![panel("window-b")])
            .unwrap();

        registry
            .invoke("instance-a", "window-a", "bookmark:same".into())
            .unwrap();

        let message = receiver_a.try_recv().unwrap();
        assert!(matches!(
            message,
            ServerMessage::Invoke { window_uid, action_uid, .. }
                if window_uid == "window-a" && action_uid == "bookmark:same"
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
            .sync(connection_a, 1, vec![panel("window-a")])
            .unwrap();
        registry
            .sync(connection_b, 1, vec![panel("window-b")])
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
            .sync(connection, 1, vec![panel("window-a")])
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
            .sync(old_connection, 1, vec![panel("window-a")])
            .unwrap();

        registry.register(new_connection, instance("instance-a"), new_sender);

        assert!(registry.disconnect(old_connection).is_none());
        let outcome = registry
            .sync(new_connection, 1, vec![panel("window-b")])
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
            .sync(old_connection, 1, vec![panel("window-a")])
            .unwrap();

        let disconnected = registry.disconnect(old_connection);
        assert_eq!(
            disconnected,
            Some(("instance-a".into(), vec!["window-a".into()]))
        );
        assert!(registry.panel("instance-a", "window-a").is_some());

        registry.register(new_connection, instance("instance-a"), new_sender);
        let outcome = registry
            .sync(new_connection, 1, vec![panel("window-b")])
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
                .sync(connection, 2, vec![panel("window-a")])
                .unwrap()
                .is_some()
        );
        assert!(
            registry
                .sync(connection, 2, vec![panel("window-a")])
                .unwrap()
                .is_none()
        );
        assert!(
            registry
                .sync(connection, 1, vec![panel("window-a")])
                .unwrap()
                .is_none()
        );
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
            always_on_top: false,
            menus: vec![],
            window: BrowserWindowSnapshot {
                uid: window_uid.into(),
                focused: true,
                state: BrowserWindowState::Normal,
                bounds: WindowBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 1200.0,
                    height: 800.0,
                },
            },
        }
    }
}
