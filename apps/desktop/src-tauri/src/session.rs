use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

use crate::protocol::{
    BrowserInstance, MenuPlacement, MenuSpacing, NativeMessage, SyncedMenu, SyncedNativeShortcut,
};

#[derive(Default)]
pub struct SessionRegistry {
    sessions: RwLock<HashMap<String, Session>>,
}

struct Session {
    connection_uid: Option<Uuid>,
    instance: BrowserInstance,
    outgoing: Option<UnboundedSender<NativeMessage>>,
    // The optional window UID distinguishes one instance-wide free menu from each bound copy.
    menus: HashMap<(Option<String>, String), SyncedMenu>,
    native_shortcuts: Vec<SyncedNativeShortcut>,
    revision: u64,
}

pub struct SyncOutcome {
    pub instance_uid: String,
    pub menus: Vec<SyncedMenu>,
    pub removed_window_uids: Vec<String>,
    pub reset_menu_uids: Vec<String>,
    pub native_shortcuts: Vec<SyncedNativeShortcut>,
}

pub struct InstanceMenusSnapshot {
    pub instance_uid: String,
    pub menus: Vec<SyncedMenu>,
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
        outgoing: UnboundedSender<NativeMessage>,
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
                    menus: HashMap::new(),
                    native_shortcuts: Vec::new(),
                    revision: 0,
                },
            );
        }
    }

    pub fn sync(
        &self,
        connection_uid: Uuid,
        revision: u64,
        menus: Vec<SyncedMenu>,
        reset_menu_uids: Vec<String>,
        native_shortcuts: Vec<SyncedNativeShortcut>,
    ) -> Result<Option<SyncOutcome>, String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .values_mut()
            .find(|session| session.connection_uid == Some(connection_uid))
            .ok_or("The connection has not registered an instance")?;

        if revision <= session.revision {
            return Ok(None);
        }

        let previous_window_uids = window_uids(session.menus.values());
        let next = menus
            .iter()
            .map(|synced| (menu_key(synced), synced.clone()))
            .collect::<HashMap<_, _>>();
        let next_window_uids = window_uids(next.values());
        let removed_window_uids = previous_window_uids
            .difference(&next_window_uids)
            .cloned()
            .collect();
        session.menus = next;
        session.native_shortcuts = native_shortcuts.clone();
        session.revision = revision;

        Ok(Some(SyncOutcome {
            instance_uid: session.instance.uid.clone(),
            menus,
            removed_window_uids,
            reset_menu_uids,
            native_shortcuts,
        }))
    }

    pub fn free_menu(&self, instance_uid: &str, menu_uid: &str) -> Option<SyncedMenu> {
        self.sessions
            .read()
            .ok()?
            .get(instance_uid)?
            .menus
            .get(&(None, menu_uid.to_owned()))
            .cloned()
    }

    pub fn invoke(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: String,
        action_uid: String,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get(instance_uid)
            .ok_or("The browser instance is disconnected")?;
        if !session
            .menus
            .keys()
            .any(|(stored_window_uid, _)| stored_window_uid.as_deref() == Some(window_uid))
        {
            return Err("The bound browser window is unavailable".into());
        }
        if !session
            .menus
            .contains_key(&(Some(window_uid.to_owned()), menu_uid.clone()))
        {
            return Err("The bound menu is unavailable".into());
        }

        session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?
            .send(NativeMessage::Invoke {
                action_uid,
                window_uid: Some(window_uid.to_owned()),
                menu_uid: Some(menu_uid),
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
            .send(NativeMessage::Invoke {
                action_uid,
                window_uid: None,
                menu_uid: Some(menu_uid),
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    pub fn invoke_shortcut(
        &self,
        instance_uid: &str,
        window_uid: Option<String>,
        shortcut_id: &str,
    ) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get(instance_uid)
            .ok_or("The browser instance is disconnected")?;
        session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?
            .send(NativeMessage::Invoke {
                action_uid: format!("shortcut:{shortcut_id}"),
                window_uid,
                menu_uid: None,
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    pub fn find_shortcut_by_key(
        &self,
        instance_uid: &str,
        key: &str,
    ) -> Option<SyncedNativeShortcut> {
        let sessions = self.sessions.read().ok()?;
        let session = sessions.get(instance_uid)?;
        session
            .native_shortcuts
            .iter()
            .find(|s| s.key.eq_ignore_ascii_case(key))
            .cloned()
    }

    pub fn all_active_shortcut_keys(&self) -> HashSet<String> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .values()
                    .filter(|s| s.outgoing.is_some())
                    .flat_map(|s| s.native_shortcuts.iter().map(|sc| sc.key.to_ascii_lowercase()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn menu(
        &self,
        instance_uid: &str,
        window_uid: &str,
        menu_uid: &str,
    ) -> Option<SyncedMenu> {
        let sessions = self.sessions.read().ok()?;
        let session = sessions.get(instance_uid)?;
        session
            .menus
            .get(&(Some(window_uid.to_owned()), menu_uid.to_owned()))
            .cloned()
    }

    pub fn window_menus(&self, instance_uid: &str, window_uid: &str) -> Vec<SyncedMenu> {
        self.sessions
            .read()
            .ok()
            .and_then(|sessions| {
                let session = sessions.get(instance_uid)?;
                Some(
                    session
                        .menus
                        .iter()
                        .filter(|((stored_window_uid, _), _)| {
                            stored_window_uid.as_deref() == Some(window_uid)
                        })
                        .map(|(_, synced)| synced.clone())
                        .collect(),
                )
            })
            .unwrap_or_default()
    }

    pub fn window_snapshot(
        &self,
        instance_uid: &str,
        window_uid: &str,
    ) -> Option<crate::protocol::BrowserWindowSnapshot> {
        self.window_menus(instance_uid, window_uid)
            .into_iter()
            .find_map(|synced| synced.bound_window().cloned())
    }

    pub fn has_window(&self, instance_uid: &str, window_uid: &str) -> bool {
        !self.window_menus(instance_uid, window_uid).is_empty()
    }

    pub fn menu_snapshots(&self) -> Vec<(String, Vec<SyncedMenu>)> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(instance_uid, session)| {
                        (
                            instance_uid.clone(),
                            session.menus.values().cloned().collect(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn instance_menu_snapshots(&self) -> Vec<InstanceMenusSnapshot> {
        self.sessions
            .read()
            .map(|sessions| {
                sessions
                    .iter()
                    .map(|(instance_uid, session)| InstanceMenusSnapshot {
                        instance_uid: instance_uid.clone(),
                        menus: session.menus.values().cloned().collect(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn update_menu_layout(
        &self,
        instance_uid: &str,
        menu_uid: String,
        placement: MenuPlacement,
        spacing: MenuSpacing,
        settings: crate::protocol::NativeBarSettings,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().map_err(|_| "Session lock failed")?;
        let session = sessions
            .get_mut(instance_uid)
            .ok_or("The browser instance is disconnected")?;

        for synced in session.menus.values_mut() {
            if synced.view.uid == menu_uid {
                settings.apply_view(&mut synced.view);
                synced.view.gap_ratio = Some(spacing.gap_ratio);
                synced.view.extra_gaps = spacing.extra_gaps.clone();
                synced.placement = placement;
            }
        }

        let outgoing = session
            .outgoing
            .as_ref()
            .ok_or("The browser instance is disconnected")?;
        outgoing
            .send(NativeMessage::UpdateMenuLayout {
                menu_uid,
                placement,
                spacing,
                settings,
            })
            .map_err(|_| "The browser instance is disconnected".into())
    }

    pub fn broadcast_editing_state(&self, editing: bool) {
        if let Ok(sessions) = self.sessions.read() {
            for session in sessions.values() {
                if let Some(outgoing) = &session.outgoing {
                    let _ = outgoing.send(NativeMessage::EditingState { editing });
                }
            }
        }
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
            window_uids(session.menus.values()).into_iter().collect(),
        ))
    }

    pub fn detach(&self, connection_uid: Uuid) -> Option<String> {
        let mut sessions = self.sessions.write().ok()?;
        let instance_uid = sessions
            .iter()
            .find(|(_, session)| session.connection_uid == Some(connection_uid))?
            .0
            .clone();
        sessions.remove(&instance_uid);
        Some(instance_uid)
    }

    pub fn disconnect_all(&self) -> Vec<(String, Vec<String>)> {
        self.sessions
            .write()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(instance_uid, session)| {
                        (
                            instance_uid,
                            window_uids(session.menus.values()).into_iter().collect(),
                        )
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
                        windows_count: window_uids(s.menus.values()).len(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

fn menu_key(synced: &SyncedMenu) -> (Option<String>, String) {
    (
        synced.bound_window().map(|window| window.uid.clone()),
        synced.view.uid.clone(),
    )
}

fn window_uids<'a>(menus: impl Iterator<Item = &'a SyncedMenu>) -> HashSet<String> {
    menus
        .filter_map(|synced| synced.bound_window().map(|window| window.uid.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc::unbounded_channel;
    use uuid::Uuid;

    use super::SessionRegistry;
    use crate::protocol::{
        AttachmentMode, BrowserInstance, BrowserWindowSnapshot, MenuAnchor, MenuBoundPosition,
        MenuNativeProps, MenuOrientation, MenuPlacement, MenuTarget, MenuView, NativeMessage,
        OnTopMode, SyncedMenu, WindowBounds,
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
            .sync(connection_a, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();
        registry
            .sync(connection_b, 1, vec![menu("window-b")], Vec::new(), Vec::new())
            .unwrap();

        registry
            .invoke(
                "instance-a",
                "window-a",
                "menu-window-a".into(),
                "bookmark:same".into(),
            )
            .unwrap();

        let message = receiver_a.try_recv().unwrap();
        assert!(matches!(
            message,
            NativeMessage::Invoke { window_uid, action_uid, menu_uid }
                if window_uid.as_deref() == Some("window-a")
                    && menu_uid.as_deref() == Some("menu-window-a")
                    && action_uid == "bookmark:same"
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
            .sync(connection_a, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();
        registry
            .sync(connection_b, 1, vec![menu("window-b")], Vec::new(), Vec::new())
            .unwrap();

        let result = registry.invoke(
            "instance-a",
            "window-b",
            "menu-window-b".into(),
            "bookmark:same".into(),
        );

        assert_eq!(
            result.unwrap_err(),
            "The bound browser window is unavailable"
        );
        assert!(receiver_a.try_recv().is_err());
        assert!(receiver_b.try_recv().is_err());
    }

    #[test]
    fn disconnecting_all_instances_removes_their_menus_and_routes() {
        let registry = SessionRegistry::default();
        let connection = Uuid::new_v4();
        let (sender, _) = unbounded_channel();
        registry.register(connection, instance("instance-a"), sender);
        registry
            .sync(connection, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();

        let disconnected = registry.disconnect_all();

        assert_eq!(disconnected.len(), 1);
        assert_eq!(disconnected[0].0, "instance-a");
        assert_eq!(disconnected[0].1, vec!["window-a"]);
        assert!(!registry.has_window("instance-a", "window-a"));
    }

    #[test]
    fn detaching_removes_only_that_instances_menus_and_does_not_restore_them_on_reconnect() {
        let registry = SessionRegistry::default();
        let connection_a = Uuid::new_v4();
        let connection_b = Uuid::new_v4();
        let (sender_a, _) = unbounded_channel();
        let (sender_b, _) = unbounded_channel();
        registry.register(connection_a, instance("instance-a"), sender_a);
        registry.register(connection_b, instance("instance-b"), sender_b);
        registry
            .sync(connection_a, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();
        registry
            .sync(connection_b, 1, vec![menu("window-b")], Vec::new(), Vec::new())
            .unwrap();

        assert_eq!(registry.detach(connection_a).as_deref(), Some("instance-a"));
        assert!(!registry.has_window("instance-a", "window-a"));
        assert!(registry.has_window("instance-b", "window-b"));
        assert!(registry.disconnect(connection_a).is_none());

        let new_connection = Uuid::new_v4();
        let (new_sender, _) = unbounded_channel();
        registry.register(new_connection, instance("instance-a"), new_sender);
        assert!(!registry.has_window("instance-a", "window-a"));
        registry
            .sync(new_connection, 1, vec![menu("window-new")], Vec::new(), Vec::new())
            .unwrap();
        assert!(registry.has_window("instance-a", "window-new"));
        assert!(registry.has_window("instance-b", "window-b"));
    }

    #[test]
    fn replacing_a_connection_keeps_its_menus_for_the_first_new_sync() {
        let registry = SessionRegistry::default();
        let old_connection = Uuid::new_v4();
        let new_connection = Uuid::new_v4();
        let (old_sender, _old_receiver) = unbounded_channel();
        let (new_sender, _new_receiver) = unbounded_channel();

        registry.register(old_connection, instance("instance-a"), old_sender);
        registry
            .sync(old_connection, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();

        registry.register(new_connection, instance("instance-a"), new_sender);

        assert!(registry.detach(old_connection).is_none());
        assert!(registry.disconnect(old_connection).is_none());
        let outcome = registry
            .sync(new_connection, 1, vec![menu("window-b")], Vec::new(), Vec::new())
            .unwrap()
            .expect("sync outcome");
        assert_eq!(outcome.removed_window_uids, vec!["window-a"]);
        assert!(registry.has_window("instance-a", "window-b"));
    }

    #[test]
    fn disconnecting_then_reconnecting_keeps_menus_for_next_sync() {
        let registry = SessionRegistry::default();
        let old_connection = Uuid::new_v4();
        let new_connection = Uuid::new_v4();
        let (old_sender, _old_receiver) = unbounded_channel();
        let (new_sender, _new_receiver) = unbounded_channel();

        registry.register(old_connection, instance("instance-a"), old_sender);
        registry
            .sync(old_connection, 1, vec![menu("window-a")], Vec::new(), Vec::new())
            .unwrap();

        let disconnected = registry.disconnect(old_connection);
        assert_eq!(
            disconnected,
            Some(("instance-a".into(), vec!["window-a".into()]))
        );
        assert!(registry.has_window("instance-a", "window-a"));

        registry.register(new_connection, instance("instance-a"), new_sender);
        let outcome = registry
            .sync(new_connection, 1, vec![menu("window-b")], Vec::new(), Vec::new())
            .unwrap()
            .expect("sync outcome");
        assert_eq!(outcome.removed_window_uids, vec!["window-a"]);
        assert!(registry.has_window("instance-a", "window-b"));
    }

    #[test]
    fn ignores_stale_sync_revisions() {
        let registry = SessionRegistry::default();
        let connection = Uuid::new_v4();
        let (sender, _) = unbounded_channel();
        registry.register(connection, instance("instance-a"), sender);
        assert!(
            registry
                .sync(connection, 2, vec![menu("window-a")], Vec::new(), Vec::new())
                .unwrap()
                .is_some()
        );
        assert!(
            registry
                .sync(connection, 2, vec![menu("window-a")], Vec::new(), Vec::new())
                .unwrap()
                .is_none()
        );
        assert!(
            registry
                .sync(connection, 1, vec![menu("window-a")], Vec::new(), Vec::new())
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
            vec![menu("window-1"), menu("window-2")],
            Vec::new(),
            Vec::new(),
        );

        let exts = registry.active_extensions();
        assert_eq!(exts.len(), 2);
        let ext_a = exts
            .iter()
            .find(|e| e.instance_uid == "instance-a")
            .unwrap();
        assert_eq!(ext_a.browser.as_deref(), Some("chrome"));
        assert_eq!(ext_a.label.as_deref(), Some("Work Profile"));
        assert_eq!(ext_a.windows_count, 2);

        let ext_b = exts
            .iter()
            .find(|e| e.instance_uid == "instance-b")
            .unwrap();
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

    fn menu(window_uid: &str) -> SyncedMenu {
        SyncedMenu {
            view: MenuView {
                uid: format!("menu-{window_uid}"),
                items: vec![],
                orientation: MenuOrientation::Row,
                auto_hide: Default::default(),
                auto_hide_padding: 6.0,
                auto_hide_range: None,
                font_family: None,
                color: None,
                expand_direction: None,
                expand_alignment: None,
                button_font_size: None,
                popup_font_size: None,
                gap_ratio: None,
                extra_gaps: Default::default(),
                dock_color: None,
            },
            placement: MenuPlacement {
                bound_position: MenuBoundPosition {
                    anchor: MenuAnchor::TopLeft,
                    offset_x: 0.0,
                    offset_y: 0.0,
                },
                free_position: None,
                item_width: None,
                item_height: None,
            },
            native: MenuNativeProps {
                attachment_mode: AttachmentMode::All,
                on_top_mode: OnTopMode::AboveBrowser,
                visible: true,
            },
            target: MenuTarget::Window {
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
            },
        }
    }
}
