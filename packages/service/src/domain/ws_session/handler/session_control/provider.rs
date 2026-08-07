use axum::extract::ws::Message;
use tracing::error;

use super::super::super::protocol::*;
use super::super::helpers::{parse_session_id, send_error};
use super::super::types::{QueryState, SdkSessions, WsSender};
use super::session_has_messages;
use crate::app_state::AppState;
use crate::domain::agents::adapter::access_mode_wire;
use crate::domain::agents::providers::{provider_default_model, provider_model_catalog_entry};
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
    model: &str,
    supports_prompt_receipts: bool,
    codex_permission_mode: Option<&str>,
) {
    let reply = WsEnvelope::session_reply(
        envelope_id,
        WsSessionAction::ProviderSetOk,
        ProviderSetOkPayload {
            provider: provider.to_string(),
            model: model.to_string(),
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

    let (provider_changed, active_model) = {
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
        let active_model = handle.desired_model.clone().unwrap_or_default();
        let is_changed = match &handle.state {
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
        };
        (is_changed, active_model)
    };

    if !provider_changed {
        send_provider_set_ok(
            sender,
            &envelope.id,
            &payload.provider,
            &active_model,
            supports_prompt_receipts,
            None,
        );
        return;
    }

    let configured_access_mode = adapter.configured_access_mode(&app_state.read_pool).await;
    let configured_access_wire = configured_access_mode.as_ref().map(access_mode_wire);
    let new_mode_wire = adapter.default_permission_mode_wire();
    let new_mode_wire = new_mode_wire.as_ref();
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
    let (feature_id, active_model) = {
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
        let old_desired_model = handle.desired_model.clone();
        let new_provider = payload.provider.clone();
        handle.runtime_provider = new_provider.clone();
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

        // Validate that the current desired_model belongs to the new provider's
        // catalog. If it doesn't (e.g. the user switched from claude_code to
        // opencode and the model was an opencode-specific model), fall back to
        // the new provider's default and update the handle so the frontend gets
        // the corrected model in the response.
        if let Some(ref model) = old_desired_model {
            let cwd = Some(handle.config.cwd.as_path());
            let profile = handle
                .desired_claude_profile
                .as_deref()
                .or(handle.spawned_claude_profile.as_deref());
            if provider_model_catalog_entry(
                &app_state.read_pool,
                cwd,
                &new_provider,
                Some(model),
                profile,
            )
            .await
            .is_none()
            {
                tracing::info!(
                    old_model = %model,
                    new_provider = %new_provider,
                    "desired_model does not belong to the new provider; falling back to provider default"
                );
                if let Some(default_model) =
                    provider_default_model(&app_state.read_pool, &new_provider).await
                {
                    handle.desired_model = Some(default_model.clone());
                    options.model = Some(default_model);
                }
            }
        }

        (
            handle.feature_id,
            handle.desired_model.clone().unwrap_or_default(),
        )
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
            model: active_model,
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
