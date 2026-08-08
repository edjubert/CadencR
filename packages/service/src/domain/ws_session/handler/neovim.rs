//! Handle `neovim` domain actions — client → server keystroke forwarding to
//! the headless Neovim process managed by `domain::neovim::NeovimManager`.

use axum::extract::ws::Message;
use tracing::warn;

use super::super::protocol::{NeovimKeyInputPayload, SessionErrorPayload, WsEnvelope};
use super::WsSender;
use crate::app_state::AppState;

/// Handle `neovim` domain actions.
pub(super) async fn handle_neovim_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "key_input" => handle_key_input(envelope, sender, app_state).await,
        unknown => {
            let err = WsEnvelope::reply(
                &envelope.id,
                "neovim",
                "error",
                serde_json::to_value(SessionErrorPayload {
                    code: "UNKNOWN_ACTION".into(),
                    message: format!("Unknown neovim action: {unknown}"),
                    ..Default::default()
                })
                .unwrap(),
            );
            let _ = sender.send(Message::Text(String::from(err).into()));
        }
    }
}

async fn handle_key_input(envelope: WsEnvelope, sender: &WsSender, app_state: &AppState) {
    let feature_id = match envelope.payload.get("feature_id").and_then(|v| v.as_i64()) {
        Some(id) => id,
        None => {
            super::send_error(sender, &envelope.id, "BAD_REQUEST", "missing feature_id");
            return;
        }
    };
    let payload: NeovimKeyInputPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(payload) => payload,
        Err(e) => {
            super::send_error(
                sender,
                &envelope.id,
                "BAD_REQUEST",
                &format!("invalid key_input payload: {e}"),
            );
            return;
        }
    };

    if let Err(e) = app_state
        .neovim_manager
        .send_keys(feature_id, &payload.file_path, &payload.keys)
        .await
    {
        warn!(feature_id, error = %e, "neovim send_keys failed");
        super::send_error(sender, &envelope.id, "NEOVIM_SEND_KEYS_FAILED", &e.to_string());
    }
}
