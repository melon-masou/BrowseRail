use std::fmt;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerState {
    Unbound,
    Listening { port: u16 },
    Failed { port: u16, error: String },
}

impl fmt::Display for ServerState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unbound => write!(f, "Unbound"),
            Self::Listening { port } => write!(f, "Listening(port: {port})"),
            Self::Failed { port, error } => write!(f, "Failed(port: {port}, error: {error})"),
        }
    }
}

pub struct ServerStateMachine {
    state: Mutex<ServerState>,
}

impl Default for ServerStateMachine {
    fn default() -> Self {
        Self {
            state: Mutex::new(ServerState::Unbound),
        }
    }
}

impl ServerStateMachine {
    #[allow(dead_code)]
    pub fn current(&self) -> ServerState {
        self.state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ServerState::Unbound)
    }

    pub fn transition(&self, next: ServerState, detail: Option<&str>) {
        if let Ok(mut current) = self.state.lock() {
            if *current != next {
                let detail_str = detail.map(|d| format!(" ({d})")).unwrap_or_default();
                eprintln!("[BrowseRail:Tauri:Server] {} -> {}{detail_str}", *current, next);
                *current = next;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionState {
    Initial,
    Connected {
        connection_uid: Uuid,
    },
    Handshaking {
        connection_uid: Uuid,
    },
    Ready {
        connection_uid: Uuid,
        instance_uid: String,
    },
    Syncing {
        connection_uid: Uuid,
        instance_uid: String,
        revision: u64,
    },
    Active {
        connection_uid: Uuid,
        instance_uid: String,
    },
    Disconnected {
        connection_uid: Uuid,
        instance_uid: Option<String>,
    },
}

impl fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Initial => write!(f, "Initial"),
            Self::Connected { connection_uid } => write!(f, "Connected(conn: {connection_uid})"),
            Self::Handshaking { connection_uid } => {
                write!(f, "Handshaking(conn: {connection_uid})")
            }
            Self::Ready {
                connection_uid,
                instance_uid,
            } => write!(
                f,
                "Ready(conn: {connection_uid}, instance: {instance_uid})"
            ),
            Self::Syncing {
                connection_uid,
                instance_uid,
                revision,
            } => write!(
                f,
                "Syncing(conn: {connection_uid}, instance: {instance_uid}, rev: {revision})"
            ),
            Self::Active {
                connection_uid,
                instance_uid,
            } => write!(
                f,
                "Active(conn: {connection_uid}, instance: {instance_uid})"
            ),
            Self::Disconnected {
                connection_uid,
                instance_uid,
            } => write!(
                f,
                "Disconnected(conn: {connection_uid}, instance: {})",
                instance_uid.as_deref().unwrap_or("<unknown>")
            ),
        }
    }
}

pub struct ConnectionStateMachine {
    current: ConnectionState,
}

impl Default for ConnectionStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectionStateMachine {
    pub fn new() -> Self {
        Self {
            current: ConnectionState::Initial,
        }
    }

    #[allow(dead_code)]
    pub fn current(&self) -> &ConnectionState {
        &self.current
    }

    pub fn transition(&mut self, next: ConnectionState, detail: Option<&str>) {
        if self.current != next {
            let detail_str = detail.map(|d| format!(" ({d})")).unwrap_or_default();
            eprintln!(
                "[BrowseRail:Tauri:Connection] {} -> {}{detail_str}",
                self.current, next
            );
            self.current = next;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceState {
    Created,
    Hidden,
    Visible,
    Customizing,
}

impl fmt::Display for SurfaceState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Created => write!(f, "Created"),
            Self::Hidden => write!(f, "Hidden"),
            Self::Visible => write!(f, "Visible"),
            Self::Customizing => write!(f, "Customizing"),
        }
    }
}

pub fn log_surface_transition(
    label: &str,
    prev: SurfaceState,
    next: SurfaceState,
    detail: Option<&str>,
) {
    if prev != next {
        let detail_str = detail.map(|d| format!(" ({d})")).unwrap_or_default();
        eprintln!(
            "[BrowseRail:Tauri:Surface:{label}] {prev} -> {next}{detail_str}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_state_machine_transitions() {
        let sm = ServerStateMachine::default();
        assert_eq!(sm.current(), ServerState::Unbound);

        sm.transition(ServerState::Listening { port: 17654 }, Some("Started"));
        assert_eq!(sm.current(), ServerState::Listening { port: 17654 });

        sm.transition(
            ServerState::Failed {
                port: 17654,
                error: "Address in use".into(),
            },
            Some("Error"),
        );
        assert_eq!(
            sm.current(),
            ServerState::Failed {
                port: 17654,
                error: "Address in use".into()
            }
        );
    }

    #[test]
    fn connection_state_machine_lifecycle() {
        let conn_id = Uuid::new_v4();
        let mut sm = ConnectionStateMachine::new();
        assert_eq!(*sm.current(), ConnectionState::Initial);

        sm.transition(
            ConnectionState::Connected {
                connection_uid: conn_id,
            },
            Some("TCP connected"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Connected {
                connection_uid: conn_id
            }
        );

        sm.transition(
            ConnectionState::Handshaking {
                connection_uid: conn_id,
            },
            Some("Awaiting hello"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Handshaking {
                connection_uid: conn_id
            }
        );

        sm.transition(
            ConnectionState::Ready {
                connection_uid: conn_id,
                instance_uid: "inst-1".into(),
            },
            Some("Registered"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Ready {
                connection_uid: conn_id,
                instance_uid: "inst-1".into()
            }
        );

        sm.transition(
            ConnectionState::Syncing {
                connection_uid: conn_id,
                instance_uid: "inst-1".into(),
                revision: 1,
            },
            Some("Syncing panels"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Syncing {
                connection_uid: conn_id,
                instance_uid: "inst-1".into(),
                revision: 1
            }
        );

        sm.transition(
            ConnectionState::Active {
                connection_uid: conn_id,
                instance_uid: "inst-1".into(),
            },
            Some("Active"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Active {
                connection_uid: conn_id,
                instance_uid: "inst-1".into()
            }
        );

        sm.transition(
            ConnectionState::Disconnected {
                connection_uid: conn_id,
                instance_uid: Some("inst-1".into()),
            },
            Some("Closed"),
        );
        assert_eq!(
            *sm.current(),
            ConnectionState::Disconnected {
                connection_uid: conn_id,
                instance_uid: Some("inst-1".into())
            }
        );
    }
}
