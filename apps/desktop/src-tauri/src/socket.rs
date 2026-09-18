use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
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
            self.state_machine
                .transition(ServerState::Unbound, Some("Stopping previous listener"));
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

async fn handle_http_debug(mut stream: TcpStream) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = [0u8; 2048];
    let _ = stream.read(&mut buf).await;

    if !crate::debug::is_debug_enabled() {
        let body = "Debug interface is disabled\n";
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\n\
            Content-Type: text/plain; charset=utf-8\r\n\
            Content-Length: {}\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Connection: close\r\n\r\n\
            {}",
            body.len(),
            body
        );
        stream.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;
        stream.flush().await.map_err(|e| e.to_string())?;
        return Ok(());
    }

    let snapshot = crate::debug::get_debug_snapshot();
    let json = serde_json::to_string_pretty(&snapshot).unwrap_or_else(|_| "{}".to_string());
    let response = format!(
        "HTTP/1.1 200 OK\r\n\
        Content-Type: application/json; charset=utf-8\r\n\
        Content-Length: {}\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Access-Control-Allow-Methods: GET, OPTIONS\r\n\
        Access-Control-Allow-Headers: *\r\n\
        Connection: close\r\n\r\n\
        {}",
        json.len(),
        json
    );
    stream.write_all(response.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn handle_connection(
    native_sender: UnboundedSender<NativeCommand>,
    stream: TcpStream,
) -> Result<(), String> {
    let mut peek_buf = [0u8; 1024];
    let n = stream.peek(&mut peek_buf).await.map_err(|e| e.to_string())?;
    if n > 0 {
        let peek_str = String::from_utf8_lossy(&peek_buf[..n]);
        let lower = peek_str.to_ascii_lowercase();
        let is_debug_route = lower.starts_with("get /debug") || lower.starts_with("get /api/debug");
        let is_plain_http_get = lower.starts_with("get /") && !lower.contains("upgrade: websocket");
        if is_debug_route || is_plain_http_get {
            return handle_http_debug(stream).await;
        }
    }

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
    crate::debug::log("Socket", format!("WebSocket upgraded: {connection_uid}"));

    let result = async {
        loop {
            tokio::select! {
                incoming = reader.next() => {
                    let Some(incoming) = incoming else { break };
                    let incoming = incoming.map_err(|error| error.to_string())?;
                    match incoming {
                        Message::Close(_) => {
                            let _ = writer.send(Message::Close(None)).await;
                            break;
                        }
                        Message::Text(text) => {
                            let message = serde_json::from_str::<ClientMessage>(&text)
                                .map_err(|error| format!("Invalid client message: {error}"))?;
                            match message {
                                ClientMessage::Hello { protocol_version, instance } => {
                                    if registered_instance.is_some() || protocol_version != PROTOCOL_VERSION {
                                        crate::debug::log("Socket", format!("Invalid hello: proto={protocol_version}, reg={:?}", registered_instance));
                                        return Err("Invalid hello message".into());
                                    }
                                    let instance_uid = instance.uid.clone();
                                    registered_instance = Some(instance_uid.clone());
                                    crate::debug::log("Socket", format!("Hello accepted: instance={instance_uid}, browser={:?}, label={:?}", instance.browser, instance.label));
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
                                    let Some(ref inst_uid) = registered_instance else {
                                        return Err("Sync received before Hello".into());
                                    };
                                    crate::debug::log("Socket", format!("Sync: inst={inst_uid}, rev={revision}, mode={:?}, panels={}", attachment_mode, panels.len()));
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
                                        attachment_mode,
                                        panels,
                                    });
                                    connection_sm.transition(
                                        ConnectionState::Active {
                                            connection_uid,
                                            instance_uid: inst_uid.clone(),
                                        },
                                        Some("Sync applied"),
                                    );
                                }
                                ClientMessage::ActionResult { request_uid, ok, message } => {
                                    let _ = native_sender.send(NativeCommand::ActionResult {
                                        request_uid,
                                        ok,
                                        message,
                                    });
                                }
                                ClientMessage::PairWindow { request_uid, window_uid } => {
                                    let Some(ref instance_uid) = registered_instance else {
                                        return Err("Pairing received before Hello".into());
                                    };
                                    crate::debug::log("Socket", format!("PairWindow: inst={instance_uid}, req={request_uid}, win={window_uid}"));
                                    let _ = native_sender.send(NativeCommand::BeginWindowPairing {
                                        connection_uid,
                                        instance_uid: instance_uid.clone(),
                                        request_uid,
                                        window_uid,
                                        outgoing: outgoing.clone(),
                                    });
                                }
                                ClientMessage::ConfirmWindowPairing { request_uid, window_uid } => {
                                    let Some(ref instance_uid) = registered_instance else {
                                        return Err("Pairing confirmation received before Hello".into());
                                    };
                                    crate::debug::log("Socket", format!("ConfirmWindowPairing: inst={instance_uid}, req={request_uid}, win={window_uid}"));
                                    let _ = native_sender.send(NativeCommand::ConfirmWindowPairing {
                                        connection_uid,
                                        instance_uid: instance_uid.clone(),
                                        request_uid,
                                        window_uid,
                                        outgoing: outgoing.clone(),
                                    });
                                }
                                ClientMessage::ClientDebugLog { time, tag, message, details } => {
                                    let details_str = details
                                        .map(|d| format!(" details={}", serde_json::to_string(&d).unwrap_or_default()))
                                        .unwrap_or_default();
                                    crate::debug::log(format!("Ext:{tag}"), format!("[{time}] {message}{details_str}"));
                                }
                                ClientMessage::Resync { request_uid } => {
                                    let Some(ref instance_uid) = registered_instance else {
                                        return Err("Resync received before Hello".into());
                                    };
                                    crate::debug::log("Socket", format!("Resync: inst={instance_uid}, req={request_uid}"));
                                    let _ = native_sender.send(NativeCommand::RebuildInstanceSurfaces {
                                        instance_uid: instance_uid.clone(),
                                        request_uid,
                                        outgoing: outgoing.clone(),
                                    });
                                }
                                ClientMessage::Heartbeat => {
                                    outgoing.send(ServerMessage::Heartbeat)
                                        .map_err(|_| "Connection closed")?;
                                }
                            }
                        }
                        _ => {}
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
