use axum::extract::ws::Message;
use tracing::error;

use super::super::super::protocol::*;
use super::super::helpers::{parse_session_id, send_error};
use super::super::types::{QueryState, SdkSessions, WsSender};
use super::session_has_messages;
use crate::app_state::AppState;
use crate::domain::agents::adapter::{access_mode_wire, RuntimeAccessMode};
use crate::domain::agents::providers::resolve_requested_model_or_provider_default;
use crate::domain::agents::runtime_adapter;

async fn persist_provider_selection(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    provider: &str,
    model: Option<&str>,
    codex_permission_mode: Option<&str>,
    permission_mode: &str,
) -> Result<(), sqlx::Error> {
    // The model travels with the provider in one statement: a row carrying the
    // new provider next to the previous provider's model is the exact mismatch
    // `session.init` would later restore.
    if let Some(codex_mode) = codex_permission_mode {
        sqlx::query(
            "UPDATE agent_sessions SET runtime_provider = ?, model = ?, codex_permission_mode = ?, permission_mode = ?, fast_mode = 0 WHERE id = ?",
        )
        .bind(provider)
        .bind(model)
        .bind(codex_mode)
        .bind(permission_mode)
        .bind(session_id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE agent_sessions SET runtime_provider = ?, model = ?, permission_mode = ?, fast_mode = 0 WHERE id = ?",
        )
        .bind(provider)
        .bind(model)
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

/// A failure to report back over the WS as `{code, message}`.
struct ProviderSetError {
    code: &'static str,
    message: String,
}

impl ProviderSetError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn locked() -> Self {
        Self::new(
            "PROVIDER_LOCKED",
            "Provider cannot be changed after the conversation starts",
        )
    }

    fn session_not_found() -> Self {
        Self::new("SESSION_NOT_FOUND", "Session not found")
    }
}

/// What the session looked like when the switch was accepted. Captured under
/// the lock so the model resolution can run without holding it.
struct SwitchSnapshot {
    desired_model: Option<String>,
    cwd: std::path::PathBuf,
    profile: Option<String>,
}

enum SwitchDecision {
    /// Already on the requested provider — ack with the current model.
    Unchanged {
        active_model: String,
    },
    Changed(SwitchSnapshot),
}

/// Decide whether the switch applies, and capture what resolving the new
/// model needs. Rejects sessions whose conversation has already started.
///
/// "Unchanged" requires the provider *and* the requested model (when one was
/// sent) to already match — comparing the provider alone would silently drop
/// a same-provider model change (picking model C right after model B) by
/// acknowledging the stale model instead of applying the new one.
async fn decide_switch(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
    payload: &ProviderSetPayload,
) -> Result<SwitchDecision, ProviderSetError> {
    let sessions = sdk_sessions.lock().await;
    let handle = sessions
        .get(&db_session_id)
        .ok_or_else(ProviderSetError::session_not_found)?;
    let QueryState::Pending(_) = &handle.state else {
        return Err(ProviderSetError::locked());
    };
    let provider_unchanged = handle.runtime_provider == payload.provider;
    let model_unchanged = payload
        .model
        .as_deref()
        .is_none_or(|requested| Some(requested) == handle.desired_model.as_deref());
    if provider_unchanged && model_unchanged {
        return Ok(SwitchDecision::Unchanged {
            active_model: handle.desired_model.clone().unwrap_or_default(),
        });
    }
    Ok(SwitchDecision::Changed(SwitchSnapshot {
        desired_model: handle.desired_model.clone(),
        cwd: handle.config.cwd.clone(),
        profile: handle
            .desired_claude_profile
            .clone()
            .or_else(|| handle.spawned_claude_profile.clone()),
    }))
}

/// Apply the resolved provider/model pair to the in-memory handle. Re-checks
/// the session state, since the lock was released while the model resolved.
/// Contains no `await`, so provider and model always land together.
///
/// `resolved_model` is `None` when the new provider exposes no usable model
/// (typically its CLI is not installed). The switch still applies, but the
/// model is *cleared* rather than kept: carrying the previous provider's model
/// over would leave an incompatible provider/model pair behind.
async fn commit_switch(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
    new_provider: &str,
    resolved_model: Option<String>,
    next_access_mode: Option<RuntimeAccessMode>,
) -> Result<(i64, String), ProviderSetError> {
    let mut sessions = sdk_sessions.lock().await;
    let handle = sessions
        .get_mut(&db_session_id)
        .ok_or_else(ProviderSetError::session_not_found)?;
    let QueryState::Pending(options) = &mut handle.state else {
        return Err(ProviderSetError::locked());
    };
    handle.runtime_provider = new_provider.to_string();
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
    handle.desired_model = resolved_model.clone();
    options.model = resolved_model.clone();
    Ok((handle.feature_id, resolved_model.unwrap_or_default()))
}

/// Reject the switch before the first prompt is even possible: unparseable
/// payloads, unknown providers, and sessions that already have history.
async fn validate_provider_set(
    payload: &ProviderSetPayload,
    db_session_id: i64,
    app_state: &AppState,
) -> Result<(), ProviderSetError> {
    if runtime_adapter(&payload.provider).is_none() {
        return Err(ProviderSetError::new(
            "UNSUPPORTED_PROVIDER",
            format!(
                "Runtime provider '{}' is not implemented yet",
                payload.provider
            ),
        ));
    }
    let has_messages = session_has_messages(&app_state.read_pool, db_session_id)
        .await
        .map_err(|error| {
            error!(db_session_id, %error, "failed to verify session history before provider change");
            ProviderSetError::new("DB_ERROR", "Failed to verify session history")
        })?;
    if has_messages {
        return Err(ProviderSetError::locked());
    }
    Ok(())
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
    let Some(db_session_id) = parse_session_id(&payload.session_id) else {
        send_error(
            sender,
            &envelope.id,
            "INVALID_SESSION_ID",
            "Invalid session_id",
        );
        return;
    };

    if let Err(error) = apply_provider_set(
        &envelope,
        sender,
        sdk_sessions,
        app_state,
        &payload,
        db_session_id,
    )
    .await
    {
        send_error(sender, &envelope.id, error.code, &error.message);
    }
}

/// The caller's explicit `model` (from an atomic provider+model switch) takes
/// priority over the model carried over from the previous provider. Either
/// way, the result must belong to the new provider's catalog, or we fall back
/// to its default — even when no model was requested at all, a provider switch
/// must still land on *some* model for the new provider.
///
/// Resolved before anything is written, so the provider and the model are
/// committed together.
///
/// `None` means the new provider exposes no usable model — normal when its CLI
/// is not installed. That must not block the switch: refusing it would make a
/// provider unreachable precisely when the user is trying to configure it.
/// `commit_switch` clears the model instead of keeping the old provider's.
async fn resolve_switch_model(
    app_state: &AppState,
    payload: &ProviderSetPayload,
    snapshot: &SwitchSnapshot,
) -> Option<String> {
    let requested_model = payload
        .model
        .clone()
        .or_else(|| snapshot.desired_model.clone());
    resolve_requested_model_or_provider_default(
        &app_state.read_pool,
        Some(snapshot.cwd.as_path()),
        &payload.provider,
        requested_model.as_deref(),
        snapshot.profile.as_deref(),
    )
    .await
}

async fn apply_provider_set(
    envelope: &WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
    payload: &ProviderSetPayload,
    db_session_id: i64,
) -> Result<(), ProviderSetError> {
    validate_provider_set(payload, db_session_id, app_state).await?;
    let adapter = runtime_adapter(&payload.provider).ok_or_else(|| {
        ProviderSetError::new(
            "UNSUPPORTED_PROVIDER",
            "Runtime provider is not implemented",
        )
    })?;
    let supports_prompt_receipts = adapter.supports_prompt_receipts();

    let snapshot = match decide_switch(sdk_sessions, db_session_id, payload).await? {
        SwitchDecision::Unchanged { active_model } => {
            send_provider_set_ok(
                sender,
                &envelope.id,
                &payload.provider,
                &active_model,
                supports_prompt_receipts,
                None,
            );
            return Ok(());
        }
        SwitchDecision::Changed(snapshot) => snapshot,
    };

    let resolved_model = resolve_switch_model(app_state, payload, &snapshot).await;

    let configured_access_mode = adapter.configured_access_mode(&app_state.read_pool).await;
    let configured_access_wire = configured_access_mode.as_ref().map(access_mode_wire);
    let new_mode_wire = adapter.default_permission_mode_wire();

    // DB first: a write failure here (e.g. a disk or lock error) must leave
    // the live handle untouched. Committing in memory first and persisting
    // after would instead hand the caller a DB_ERROR while the live session
    // had already moved on — other clients get no confirmation, and a
    // reconnect would read the stale provider from SQLite.
    persist_provider_selection(
        &app_state.write_pool,
        db_session_id,
        &payload.provider,
        resolved_model.as_deref(),
        configured_access_wire,
        new_mode_wire.as_ref(),
    )
    .await
    .map_err(|error| {
        error!(
            db_session_id,
            runtime_provider = %payload.provider,
            %error,
            "failed to persist runtime provider selection"
        );
        ProviderSetError::new("DB_ERROR", "Failed to persist runtime provider selection")
    })?;

    // In-memory last, re-validating state: a session that went active while
    // the model resolved and the DB was written is rejected here. The DB row
    // already reflects the new provider in that case, which the next
    // `session.init` will pick up — the same outcome the pre-refactor code
    // had no guard against at all.
    let (feature_id, active_model) = commit_switch(
        sdk_sessions,
        db_session_id,
        &payload.provider,
        resolved_model,
        configured_access_mode.clone(),
    )
    .await?;

    broadcast_provider_set(
        app_state,
        sender,
        &envelope.id,
        feature_id,
        BroadcastArgs {
            provider: payload.provider.clone(),
            model: active_model,
            supports_prompt_receipts,
            configured_access_wire,
            mode_wire: new_mode_wire.as_ref(),
        },
    )
    .await;
    Ok(())
}

struct BroadcastArgs<'a> {
    provider: String,
    model: String,
    supports_prompt_receipts: bool,
    configured_access_wire: Option<&'a str>,
    mode_wire: &'a str,
}

/// Mirror to other devices viewing this feature so their provider/mode chips
/// stay in sync (provider can only change before the first prompt).
async fn broadcast_provider_set(
    app_state: &AppState,
    sender: &WsSender,
    envelope_id: &str,
    feature_id: i64,
    args: BroadcastArgs<'_>,
) {
    super::reply_and_broadcast(
        app_state,
        sender,
        envelope_id,
        feature_id,
        WsSessionAction::ProviderSetOk,
        ProviderSetOkPayload {
            codex_permission_mode: (args.provider == crate::domain::agents::codex::PROVIDER_ID)
                .then(|| args.configured_access_wire.map(ToOwned::to_owned))
                .flatten(),
            access_mode: args.configured_access_wire.map(ToOwned::to_owned),
            provider: args.provider,
            model: args.model,
            supports_prompt_receipts: args.supports_prompt_receipts,
        },
    )
    .await;
    super::reply_and_broadcast(
        app_state,
        sender,
        envelope_id,
        feature_id,
        WsSessionAction::ModeChanged,
        ModeChangedPayload {
            mode: args.mode_wire.to_string(),
        },
    )
    .await;
}
