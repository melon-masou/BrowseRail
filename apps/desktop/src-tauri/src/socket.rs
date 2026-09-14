use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tauri::Manager;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::unbounded_channel;
use tokio::task::JoinSet;
use tokio_tungstenite::{accept_async, tungstenite::Message};
use uuid::Uuid;

use crate::AppState;
use crate::panel;
use crate::protocol::{ActionResultPayload, ClientMessage, PROTOCOL_VERSION, ServerMessage};
use crate::session::SessionRegistry;

pub struct SocketServer {
    listening: AtomicBool,
    last_error: Mutex<Option<String>>,
    port: AtomicU16,
    task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for SocketServer {
    fn default() -> Self {
        Self {
            listening: AtomicBool::new(false),
            last_error: Mutex::new(None),
            port: AtomicU16::new(0),
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
        if let Ok(mut last_error) = self.last_error.lock() {
            *last_error = Some(error);
        }
    }

    pub async fn replace(
        self: &Arc<Self>,
        app: tauri::AppHandle,
        registry: Arc<SessionRegistry>,
        listener: TcpListener,
        port: u16,
    ) -> Result<(), String> {
        let previous = self
            .task
            .lock()
            .map_err(|_| "Socket task lock failed")?
            .take();
        if let Some(previous) = previous {
            previous.abort();
            let _ = previous.await;
        }

        for (instance_uid, window_uids) in registry.disconnect_all() {
            panel::hide_panels(
                &app,
                &app.state::<AppState>().popups,
                &instance_uid,
                &window_uids,
            );
        }

        let server = self.clone();
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = serve(app, registry, listener).await {
                server.mark_unavailable(port, error);
            }
        });
        *self.task.lock().map_err(|_| "Socket task lock failed")? = Some(task);
        self.port.store(port, Ordering::Relaxed);
        self.listening.store(true, Ordering::Relaxed);
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
    app: tauri::AppHandle,
    registry: Arc<SessionRegistry>,
    listener: TcpListener,
) -> Result<(), String> {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(|error| error.to_string())?;
                let app = app.clone();
                let registry = registry.clone();
                connections.spawn(async move {
                    if let Err(error) = handle_connection(app, registry, stream).await {
                        eprintln!("BrowseRail socket connection failed: {error}");
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn handle_connection(
    app: tauri::AppHandle,
    registry: Arc<SessionRegistry>,
    stream: TcpStream,
) -> Result<(), String> {
    let connection_uid = Uuid::new_v4();
    let websocket = accept_async(stream)
        .await
        .map_err(|error| error.to_string())?;
    let (mut writer, mut reader) = websocket.split();
    let (outgoing, mut outgoing_messages) = unbounded_channel::<ServerMessage>();
    let mut registered = false;

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
                                if registered || protocol_version != PROTOCOL_VERSION {
                                    return Err("Invalid hello message".into());
                                }
                                registry.register(connection_uid, instance, outgoing.clone());
                                registered = true;
                                outgoing.send(ServerMessage::Ready { protocol_version: PROTOCOL_VERSION })
                                    .map_err(|_| "Connection closed")?;
                            }
                            ClientMessage::Sync { revision, attachment_mode, panels } => {
                                let _ = attachment_mode;
                                let outcome = registry.sync(connection_uid, revision, panels)?;
                                if app.state::<AppState>().displays_panels() {
                                    panel::sync_panels(
                                        &app,
                                        &app.state::<AppState>().popups,
                                        &outcome.instance_uid,
                                        &outcome.panels,
                                        &outcome.removed_window_uids,
                                    )?;
                                }
                            }
                            ClientMessage::ActionResult { request_uid, ok, message } => {
                                if let Some(action) = registry.resolve_action(&request_uid) {
                                    panel::emit_action_result(
                                        &app,
                                        &action.instance_uid,
                                        &action.window_uid,
                                        &ActionResultPayload { ok, message },
                                    );
                                }
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

    if let Some((instance_uid, window_uids)) = registry.disconnect(connection_uid) {
        panel::hide_panels(
            &app,
            &app.state::<AppState>().popups,
            &instance_uid,
            &window_uids,
        );
    }
    result
}
