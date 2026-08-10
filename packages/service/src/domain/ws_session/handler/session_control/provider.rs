use axum::extract::ws::Message;
use tracing::error;

use super::super::super::protocol::*;
use super::super::helpers::{default_permission_mode_wire, parse_session_id, send_error};
use super::super::types::{QueryState, SdkSessions, WsSender};
use super::session_has_messages;
use crate::app_state::AppState;
use crate::domain::agents::adapter::access_mode_wire;
use crate::domain::agents::runtime_adapter;

async fn persist_provider_selection(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    provider: &str,
    codex_permission_mode: Option<&str>,
    permission_mode: &str,
) -> Result<(), sqlx::Error> {
    if let Some(codex_mode) = codex_permission_mode {
        sqlx::query(
            "UPDATE agent_sessions SET runtime_provider = ?, codex_permission_mode = ?, permission_mode = ?, fast_mode = 0 WHERE id = ?",
        )
        .bind(provider)
        .bind(codex_mode)
        .bind(permission_mode)
        .bind(session_id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE agent_sessions SET runtime_provider = ?, permission_mode = ?, fast_mode = 0 WHERE id = ?",
        )
        .bind(provider)
        .bind(permission_mode)
        .bind(session_id)
        .execute(pool)
        .await?;
    }
    Ok(())
}

fn send_provider_set_ok(
    sender: &WsSender,
    envelope_id: &str,
    provider: &str,
    supports_prompt_receipts: bool,
    codex_permission_mode: Option<&str>,
) {
    let reply = WsEnvelope::session_reply(
        envelope_id,
        WsSessionAction::ProviderSetOk,
        ProviderSetOkPayload {
            provider: provider.to_string(),
            supports_prompt_receipts,
            codex_permission_mode: codex_permission_mode.map(ToOwned::to_owned),
            access_mode: codex_permission_mode.map(ToOwned::to_owned),
        },
    )
    .expect("provider set payload should serialize");
    let _ = sender.send(Message::Text(String::from(reply).into()));
}

/// Handle session.provider.set: change the provider before the first prompt only.
pub(crate) async fn handle_provider_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: ProviderSetPayload = match serde_json::from_value(envelope.payload.clone()) {
        Ok(p) => p,
        Err(e) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &e.to_string());
            return;
        }
    };

    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    let Some(adapter) = runtime_adapter(&payload.provider) else {
        send_error(
            sender,
            &envelope.id,
            "UNSUPPORTED_PROVIDER",
            &format!(
                "Runtime provider '{}' is not implemented yet",
                payload.provider
            ),
        );
        return;
    };
    let supports_prompt_receipts = adapter.supports_prompt_receipts();

    let has_messages = match session_has_messages(&app_state.read_pool, db_session_id).await {
        Ok(value) => value,
        Err(error) => {
            error!(db_session_id, %error, "failed to verify session history before provider change");
            send_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                "Failed to verify session history",
            );
            return;
        }
    };

    if has_messages {
        send_error(
            sender,
            &envelope.id,
            "PROVIDER_LOCKED",
            "Provider cannot be changed after the conversation starts",
        );
        return;
    }

    let provider_changed = {
        let mut sessions = sdk_sessions.lock().await;
        let handle = match sessions.get_mut(&db_session_id) {
            Some(h) => h,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "SESSION_NOT_FOUND",
                    "Session not found",
                );
                return;
            }
        };
        match &handle.state {
            QueryState::Pending(_) => handle.runtime_provider != payload.provider,
            QueryState::Active { .. } => {
                send_error(
                    sender,
                    &envelope.id,
                    "PROVIDER_LOCKED",
                    "Provider cannot be changed after the conversation starts",
                );
                return;
            }
        }
    };

    if !provider_changed {
        send_provider_set_ok(
            sender,
            &envelope.id,
            &payload.provider,
            supports_prompt_receipts,
            None,
        );
        return;
    }

    let configured_access_mode = adapter.configured_access_mode(&app_state.read_pool).await;
    let configured_access_wire = configured_access_mode.as_ref().map(access_mode_wire);
    let new_mode_wire = default_permission_mode_wire(&payload.provider);
    if let Err(error) = persist_provider_selection(
        &app_state.write_pool,
        db_session_id,
        &payload.provider,
        configured_access_wire,
        new_mode_wire,
    )
    .await
    {
        error!(
            db_session_id,
            runtime_provider = %payload.provider,
            %error,
            "failed to persist runtime provider selection"
        );
        send_error(
            sender,
            &envelope.id,
            "DB_ERROR",
            "Failed to persist runtime provider selection",
        );
        return;
    }

    let next_access_mode = configured_access_mode;
    let feature_id = {
        let mut sessions = sdk_sessions.lock().await;
        let handle = match sessions.get_mut(&db_session_id) {
            Some(h) => h,
            None => {
                send_error(
                    sender,
                    &envelope.id,
                    "SESSION_NOT_FOUND",
                    "Session not found",
                );
                return;
            }
        };
        let QueryState::Pending(options) = &mut handle.state else {
            send_error(
                sender,
                &envelope.id,
                "PROVIDER_LOCKED",
                "Provider cannot be changed after the conversation starts",
            );
            return;
        };
        handle.runtime_provider = payload.provider.clone();
        handle.resume_session_id = None;
        options.resume_session_id = None;
        handle.desired_permission_mode = None;
        handle.config.permission_mode = None;
        options.permission_mode = None;
        handle.desired_access_mode = next_access_mode.clone();
        handle.config.access_mode = next_access_mode.clone();
        options.access_mode = next_access_mode;
        handle.config.fast_mode = false;
        options.fast_mode = false;
        handle.feature_id
    };

    // Mirror to other devices viewing this feature so their provider/mode chips
    // stay in sync (provider can only change before the first prompt).
    super::reply_and_broadcast(
        app_state,
        sender,
        &envelope.id,
        feature_id,
        WsSessionAction::ProviderSetOk,
        ProviderSetOkPayload {
            codex_permission_mode: (payload.provider == crate::domain::agents::codex::PROVIDER_ID)
                .then(|| configured_access_wire.map(ToOwned::to_owned))
                .flatten(),
            access_mode: configured_access_wire.map(ToOwned::to_owned),
            provider: payload.provider,
            supports_prompt_receipts,
        },
    )
    .await;
    super::reply_and_broadcast(
        app_state,
        sender,
        &envelope.id,
        feature_id,
        WsSessionAction::ModeChanged,
        ModeChangedPayload {
            mode: new_mode_wire.to_string(),
        },
    )
    .await;
}
