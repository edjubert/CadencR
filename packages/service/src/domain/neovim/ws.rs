//! Dedicated WebSocket transport for a feature's Neovim PTY.
//!
//! Deliberately not routed through `ws_session`'s `WsEnvelope`: this carries a
//! continuous stream of raw terminal bytes, which does not fit that JSON
//! envelope. `/api/terminal/ws` sets the same precedent for the same reason.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::{info, warn};

use crate::app_state::AppState;

/// Client → server messages over the Neovim PTY socket.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Raw bytes to feed Neovim's stdin, already encoded by the client's
    /// terminal emulator (escape sequences included).
    Write {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    /// Stop streaming to this client. The Neovim process keeps running.
    Detach,
}

/// Server → client messages over the Neovim PTY socket.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Raw terminal output from Neovim.
    Data {
        data: String,
    },
    /// Sent once on attach, carrying the PTY's buffered output so a
    /// reattaching client can redraw without waiting for Neovim to repaint.
    Attached {
        scrollback: String,
    },
    Error {
        message: String,
    },
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("ServerMessage serialization should not fail")
    }
}

#[derive(Debug, Deserialize)]
pub struct NeovimWsQuery {
    pub feature_id: i64,
}

/// GET /api/neovim/ws?feature_id=<id> — upgrade to a Neovim PTY stream.
pub async fn neovim_ws_handler(
    ws: WebSocketUpgrade,
    State(app_state): State<AppState>,
    Query(query): Query<NeovimWsQuery>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, app_state, query.feature_id))
}

async fn handle_socket(socket: WebSocket, app_state: AppState, feature_id: i64) {
    let (mut sink, mut stream) = socket.split();

    // The process is started explicitly over HTTP; attaching never spawns one,
    // so a spawn failure surfaces in a real HTTP response instead of here.
    let Some(pty_id) = app_state.neovim_manager.pty_id(feature_id).await else {
        let _ = sink
            .send(Message::Text(
                ServerMessage::Error {
                    message: format!("no neovim process running for feature {feature_id}"),
                }
                .to_json()
                .into(),
            ))
            .await;
        return;
    };

    let Some(handle) = app_state
        .pty_manager
        .terminals
        .get(&pty_id)
        .map(|entry| entry.value().clone())
    else {
        let _ = sink
            .send(Message::Text(
                ServerMessage::Error {
                    message: format!("neovim pty {pty_id} is gone"),
                }
                .to_json()
                .into(),
            ))
            .await;
        return;
    };

    let scrollback = handle
        .scrollback
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contents();
    let _ = sink
        .send(Message::Text(
            ServerMessage::Attached { scrollback }.to_json().into(),
        ))
        .await;

    let mut data_rx = handle.data_tx.subscribe();
    let mut forward = tokio::spawn(async move {
        loop {
            match data_rx.recv().await {
                Ok(data) => {
                    let message = ServerMessage::Data { data }.to_json();
                    if sink.send(Message::Text(message.into())).await.is_err() {
                        break;
                    }
                }
                // A slow client that fell behind resyncs from the next frame;
                // Neovim repaints continuously, so dropping stale frames is safe.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let pty_manager = app_state.pty_manager.clone();
    let pty_id_for_input = pty_id.clone();
    loop {
        tokio::select! {
            _ = &mut forward => break,
            incoming = stream.next() => {
                let Some(Ok(Message::Text(text))) = incoming else { break };
                let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else {
                    warn!(feature_id, "unparseable neovim ws message");
                    continue;
                };
                match message {
                    ClientMessage::Write { data } => {
                        if let Err(error) = pty_manager.write_pty(&pty_id_for_input, data.as_bytes()) {
                            warn!(feature_id, %error, "failed to write to neovim pty");
                            break;
                        }
                    }
                    ClientMessage::Resize { cols, rows } => {
                        if let Err(error) = pty_manager.resize_pty(&pty_id_for_input, cols, rows) {
                            warn!(feature_id, %error, "failed to resize neovim pty");
                        }
                    }
                    ClientMessage::Detach => break,
                }
            }
        }
    }

    forward.abort();
    // Detaching never kills Neovim: the process is feature-scoped and outlives
    // any single client, exactly like the editor panel being closed and
    // reopened.
    info!(feature_id, pty_id = %pty_id, "neovim ws client detached");
}

/// Register the Neovim websocket route.
pub fn ws_routes() -> Router<AppState> {
    Router::new().route("/api/neovim/ws", get(neovim_ws_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_message_parses_write_resize_and_detach() {
        let write: ClientMessage =
            serde_json::from_str(r#"{"type":"write","data":"ihello"}"#).unwrap();
        assert!(matches!(write, ClientMessage::Write { data } if data == "ihello"));

        let resize: ClientMessage =
            serde_json::from_str(r#"{"type":"resize","cols":120,"rows":40}"#).unwrap();
        assert!(matches!(
            resize,
            ClientMessage::Resize {
                cols: 120,
                rows: 40
            }
        ));

        let detach: ClientMessage = serde_json::from_str(r#"{"type":"detach"}"#).unwrap();
        assert!(matches!(detach, ClientMessage::Detach));
    }

    #[test]
    fn server_message_serializes_with_a_type_tag() {
        let data = ServerMessage::Data {
            data: "hello".to_string(),
        };
        assert_eq!(data.to_json(), r#"{"type":"data","data":"hello"}"#);

        let attached = ServerMessage::Attached {
            scrollback: "hello".to_string(),
        };
        assert_eq!(
            attached.to_json(),
            r#"{"type":"attached","scrollback":"hello"}"#
        );

        let error = ServerMessage::Error {
            message: "no neovim running for this feature".to_string(),
        };
        assert_eq!(
            error.to_json(),
            r#"{"type":"error","message":"no neovim running for this feature"}"#
        );
    }
}
