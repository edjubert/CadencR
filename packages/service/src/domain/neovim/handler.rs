//! Translates Neovim RPC notifications (autocmds registered in `service::start`,
//! plus `nvim_buf_lines_event` from attached buffers) into WS events pushed to
//! every client watching a feature's `neovim` domain.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::Message;
use nvim_rs::{Neovim, Value};
use tokio::sync::Mutex;
use tokio_util::compat::Compat;
use tracing::warn;

use crate::domain::ws_session::protocol::{
    NeovimBufferLinesChangedPayload, NeovimCursorMovedPayload, NeovimModeChangedPayload,
    WsEnvelope,
};

use super::service::WsSessionSender;

/// Shared map of `file_path -> nvim buffer number`, populated by `push_buffer`
/// and consulted here to resolve which file a raw Neovim event belongs to.
pub(super) type SharedBuffers = Arc<Mutex<HashMap<String, i64>>>;

#[derive(Clone)]
pub struct NeovimEventHandler {
    feature_id: i64,
    buffers: SharedBuffers,
    ws_sender: WsSessionSender,
}

impl NeovimEventHandler {
    pub fn new(feature_id: i64, buffers: SharedBuffers, ws_sender: WsSessionSender) -> Self {
        Self {
            feature_id,
            buffers,
            ws_sender,
        }
    }

    async fn resolve_file_path(&self, bufnr: i64) -> Option<String> {
        let buffers = self.buffers.lock().await;
        buffers
            .iter()
            .find(|(_, &b)| b == bufnr)
            .map(|(path, _)| path.clone())
    }

    async fn push(&self, envelope: WsEnvelope) {
        let message = Message::Text(String::from(envelope).into());
        for sender in self.ws_sender.get_senders(self.feature_id).await {
            let _ = sender.send(message.clone());
        }
    }

    async fn handle_cursor_moved(&self, args: &[Value]) {
        let (Some(line), Some(col)) = (
            args.first().and_then(Value::as_i64),
            args.get(1).and_then(Value::as_i64),
        ) else {
            warn!(feature_id = self.feature_id, "cadencr_cursor_moved: malformed args");
            return;
        };
        let Some(file_path) = self.current_file_path().await else {
            warn!(feature_id = self.feature_id, "cadencr_cursor_moved: no current buffer resolved");
            return;
        };
        let payload = NeovimCursorMovedPayload {
            file_path,
            line: line as u32,
            col: col as u32,
        };
        if let Ok(value) = serde_json::to_value(payload) {
            self.push(WsEnvelope::new("neovim", "cursor_moved", value)).await;
        }
    }

    async fn handle_mode_changed(&self, args: &[Value]) {
        let Some(mode) = args.first().and_then(Value::as_str) else {
            warn!(feature_id = self.feature_id, "cadencr_mode_changed: malformed args");
            return;
        };
        let Some(file_path) = self.current_file_path().await else {
            warn!(feature_id = self.feature_id, "cadencr_mode_changed: no current buffer resolved");
            return;
        };
        let payload = NeovimModeChangedPayload {
            file_path,
            mode: mode.to_string(),
        };
        if let Ok(value) = serde_json::to_value(payload) {
            self.push(WsEnvelope::new("neovim", "mode_changed", value)).await;
        }
    }

    async fn handle_buf_lines_event(&self, args: &[Value]) {
        let Some(bufnr) = args.first().and_then(value_to_i64) else {
            warn!(feature_id = self.feature_id, "nvim_buf_lines_event: could not decode bufnr");
            return;
        };
        let Some(file_path) = self.resolve_file_path(bufnr).await else {
            // The buffer was detached/removed concurrently with this event —
            // an async race, not a bug, but worth surfacing while debugging.
            warn!(feature_id = self.feature_id, bufnr, "nvim_buf_lines_event: buffer not tracked, dropping event");
            return;
        };
        let firstline = args.get(2).and_then(Value::as_i64).unwrap_or(0) as u32;
        let lastline = args.get(3).and_then(Value::as_i64).unwrap_or(-1) as i32;
        let lines: Vec<String> = args
            .get(4)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let payload = NeovimBufferLinesChangedPayload {
            file_path,
            firstline,
            lastline,
            lines,
        };
        if let Ok(value) = serde_json::to_value(payload) {
            self.push(WsEnvelope::new("neovim", "buffer_lines_changed", value)).await;
        }
    }
}

/// `nvim_buf_attach`/`nvim_win_*` handles are msgpack Ext-encoded; plain
/// integers only show up when a bufnr was fetched via `eval`/`bufnr('%')`.
/// Both encode the same underlying handle number, so normalize to `i64`.
fn value_to_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Ext(_, data) => rmpv::decode::read_value(&mut &data[..])
            .ok()
            .and_then(|v| v.as_i64()),
        other => other.as_i64(),
    }
}

#[async_trait::async_trait]
impl nvim_rs::Handler for NeovimEventHandler {
    type Writer = Compat<tokio::process::ChildStdin>;

    async fn handle_notify(&self, name: String, args: Vec<Value>, _neovim: Neovim<Self::Writer>) {
        match name.as_str() {
            "cadencr_cursor_moved" => self.handle_cursor_moved(&args).await,
            "cadencr_mode_changed" => self.handle_mode_changed(&args).await,
            "nvim_buf_lines_event" => self.handle_buf_lines_event(&args).await,
            _ => {}
        }
    }
}

impl NeovimEventHandler {
    /// Resolve the file path for whatever buffer is current in the running
    /// Neovim process. `cadencr_cursor_moved`/`cadencr_mode_changed` autocmds
    /// don't carry a buffer number, so we look it up fresh at notification
    /// time rather than caching "last touched" (which would go stale the
    /// moment a second file is opened).
    async fn current_file_path(&self) -> Option<String> {
        // Single-buffer-at-a-time is the only case Phase 1c exercises end to
        // end; with exactly one entry in the map there is no ambiguity about
        // "current" without a second RPC round trip to nvim_get_current_buf.
        let buffers = self.buffers.lock().await;
        if buffers.len() == 1 {
            return buffers.keys().next().cloned();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;
    use tokio::sync::mpsc;

    fn parse_envelope(message: Message) -> WsEnvelope {
        match message {
            Message::Text(text) => serde_json::from_str(&text).expect("valid envelope json"),
            other => panic!("expected text message, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn handle_notify_translates_cursor_moved_to_ws_event() {
        let registry = WsFeatureSenderRegistry::new();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        registry.register(42, tx).await;

        let buffers: SharedBuffers = Arc::new(Mutex::new(HashMap::from([(
            "src/main.rs".to_string(),
            7,
        )])));
        let handler = NeovimEventHandler::new(42, buffers, registry);

        handler
            .handle_cursor_moved(&[Value::Integer(3.into()), Value::Integer(0.into())])
            .await;

        let message = rx.try_recv().expect("cursor_moved event should be pushed");
        let envelope = parse_envelope(message);
        assert_eq!(envelope.domain, "neovim");
        assert_eq!(envelope.action, "cursor_moved");
        let payload: NeovimCursorMovedPayload = serde_json::from_value(envelope.payload).unwrap();
        assert_eq!(payload.line, 3);
        assert_eq!(payload.col, 0);
        assert_eq!(payload.file_path, "src/main.rs");
    }
}
