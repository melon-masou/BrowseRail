use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::task::JoinSet;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use crate::native::NativeCommand;
use crate::protocol::{ClientMessage, PROTOCOL_VERSION, ServerMessage};
use crate::state_machine::{
    ConnectionState, ConnectionStateMachine, ServerState, ServerStateMachine,
};

pub struct SocketServer {
    listening: AtomicBool,
    last_error: Mutex<Option<String>>,
    port: AtomicU16,
    pub state_machine: Arc<ServerStateMachine>,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for SocketServer {
    fn default() -> Self {
        Self {
            listening: AtomicBool::new(false),
            last_error: Mutex::new(None),
            port: AtomicU16::new(0),
            state_machine: Arc::new(ServerStateMachine::default()),
            task: Mutex::new(None),
        }
    }
}

impl SocketServer {
    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> SocketStatus {
        SocketStatus {
            error: self.last_error.lock().ok().and_then(|error| error.clone()),
            listening: self.listening.load(Ordering::Relaxed),
            port: self.port(),
        }
    }

    pub fn mark_unavailable(&self, port: u16, error: String) {
        self.port.store(port, Ordering::Relaxed);
        self.listening.store(false, Ordering::Relaxed);
        self.state_machine.transition(
            ServerState::Failed {
                port,
                error: error.clone(),
            },
            Some("Listener error"),
        );
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = Some(error);
        }
    }

    pub async fn replace(
        self: &Arc<Self>,
        native_sender: UnboundedSender<NativeCommand>,
        listener: TcpListener,
        port: u16,
    ) -> Result<(), String> {
        let previous = self
            .task
            .lock()
            .map_err(|_| "Socket task lock failed")?
            .take();
        if let Some(previous) = previous {
            self.state_machine.transition(
                ServerState::Unbound,
                Some("Stopping previous listener"),
            );
            previous.abort();
            let _ = previous.await;
        }

        let server = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = serve(native_sender, listener).await {
                server.mark_unavailable(port, error);
            }
        });
        *self.task.lock().map_err(|_| "Socket task lock failed")? = Some(task);
        self.port.store(port, Ordering::Relaxed);
        self.listening.store(true, Ordering::Relaxed);
        self.state_machine.transition(
            ServerState::Listening { port },
            Some("TCP listener started"),
        );
        *self
            .last_error
            .lock()
            .map_err(|_| "Socket error lock failed")? = None;
        Ok(())
    }
}

#[derive(Clone)]
pub struct SocketStatus {
    pub error: Option<String>,
    pub listening: bool,
    pub port: u16,
}

pub async fn bind(port: u16) -> Result<TcpListener, String> {
    let address = format!("127.0.0.1:{port}");
    TcpListener::bind(&address)
        .await
        .map_err(|error| format!("Could not bind {address}: {error}"))
}

async fn serve(
    native_sender: UnboundedSender<NativeCommand>,
    listener: TcpListener,
) -> Result<(), String> {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(|error| error.to_string())?;
                let sender = native_sender.clone();
                connections.spawn(async move {
                    if let Err(error) = handle_connection(sender, stream).await {
                        eprintln!("BrowseRail socket connection failed: {error}");
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn handle_connection(
    native_sender: UnboundedSender<NativeCommand>,
    stream: TcpStream,
) -> Result<(), String> {
    let connection_uid = Uuid::new_v4();
    let mut connection_sm = ConnectionStateMachine::new();
    connection_sm.transition(
        ConnectionState::Connected { connection_uid },
        Some("TCP accepted & upgrading WebSocket"),
    );

    let websocket = accept_async(stream)
        .await
        .map_err(|error| error.to_string())?;
    let (mut writer, mut reader) = websocket.split();
    let (outgoing, mut outgoing_messages) = unbounded_channel::<ServerMessage>();
    let mut registered_instance: Option<String> = None;

    connection_sm.transition(
        ConnectionState::Handshaking { connection_uid },
        Some("WebSocket upgraded, waiting for Hello"),
    );

    let result = async {
        loop {
            tokio::select! {
                incoming = reader.next() => {
                    let Some(incoming) = incoming else { break };
                    let incoming = incoming.map_err(|error| error.to_string())?;
                    if let Message::Text(text) = incoming {
                        let message = serde_json::from_str::<ClientMessage>(&text)
                            .map_err(|error| format!("Invalid client message: {error}"))?;
                        match message {
                            ClientMessage::Hello { protocol_version, instance } => {
                                if registered_instance.is_some() || protocol_version != PROTOCOL_VERSION {
                                    return Err("Invalid hello message".into());
                                }
                                let instance_uid = instance.uid.clone();
                                registered_instance = Some(instance_uid.clone());
                                connection_sm.transition(
                                    ConnectionState::Ready {
                                        connection_uid,
                                        instance_uid,
                                    },
                                    Some("Hello accepted, Ready sent"),
                                );
                                let _ = native_sender.send(NativeCommand::ClientRegistered {
                                    connection_uid,
                                    instance,
                                    outgoing: outgoing.clone(),
                                });
                            }
                            ClientMessage::Sync { revision, attachment_mode, panels } => {
                                let _ = attachment_mode;
                                let Some(ref inst_uid) = registered_instance else {
                                    return Err("Sync received before Hello".into());
                                };
                                connection_sm.transition(
                                    ConnectionState::Syncing {
                                        connection_uid,
                                        instance_uid: inst_uid.clone(),
                                        revision,
                                    },
                                    Some(&format!("Menus count: {}", panels.len())),
                                );
                                let _ = native_sender.send(NativeCommand::SyncPanels {
                                    connection_uid,
                                    revision,
                                    panels,
                                });
                                connection_sm.transition(
                                    ConnectionState::Active {
                                        connection_uid,
                                        instance_uid: inst_uid.clone(),
                                    },
                                    Some("Sync dispatched to native reactor"),
                                );
                            }
                            ClientMessage::ActionResult { request_uid, ok, message } => {
                                let _ = native_sender.send(NativeCommand::ActionResult {
                                    request_uid,
                                    ok,
                                    message,
                                });
                            }
                            ClientMessage::Heartbeat => {
                                outgoing.send(ServerMessage::Heartbeat)
                                    .map_err(|_| "Connection closed")?;
                            }
                        }
                    }
                }
                outgoing = outgoing_messages.recv() => {
                    let Some(outgoing) = outgoing else { break };
                    let payload = serde_json::to_string(&outgoing).map_err(|error| error.to_string())?;
                    writer.send(Message::Text(payload.into())).await.map_err(|error| error.to_string())?;
                }
            }
        }
        Ok(())
    }
    .await;

    connection_sm.transition(
        ConnectionState::Disconnected {
            connection_uid,
            instance_uid: registered_instance.clone(),
        },
        Some("Connection closed"),
    );

    let _ = native_sender.send(NativeCommand::ClientDisconnected { connection_uid });
    result
}
