use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeConfigOverrides;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{
    RuntimeOverridesChangedPayload, RuntimeOverridesSetPayload, WsEnvelope, WsSessionAction,
};

use super::super::{parse_session_id, send_error, SdkSessions, WsSender};

pub(crate) async fn handle_runtime_overrides_set(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload: RuntimeOverridesSetPayload = match serde_json::from_value(envelope.payload.clone())
    {
        Ok(payload) => payload,
        Err(error) => {
            return send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string())
        }
    };
    let Some(session_id) = parse_session_id(&payload.session_id) else {
        return send_error(
            sender,
            &envelope.id,
            "INVALID_SESSION_ID",
            "Invalid session_id",
        );
    };
    let effective_sessions =
        super::resolve_owner_sessions(sdk_sessions, app_state, session_id).await;
    let sdk_sessions = &effective_sessions;
    let Some(patch) = payload.runtime_overrides.as_object() else {
        return send_error(
            sender,
            &envelope.id,
            "INVALID_OVERRIDES",
            "runtime_overrides must be an object",
        );
    };
    let Ok((feature_id, provider, profile, cwd, has_runtime_state, mut overrides)) =
        override_snapshot(sdk_sessions, session_id).await
    else {
        return send_error(
            sender,
            &envelope.id,
            "SESSION_NOT_FOUND",
            "Session not found",
        );
    };
    let previous_overrides = overrides.clone();
    if let Err(error) = apply_patch(&mut overrides, patch) {
        return send_error(sender, &envelope.id, "INVALID_OVERRIDES", &error);
    }
    let Some(adapter) = crate::domain::agents::providers::runtime_adapter(&provider) else {
        return send_error(
            sender,
            &envelope.id,
            "PROVIDER_UNAVAILABLE",
            "Provider is unavailable",
        );
    };
    let effective = match adapter
        .resolve_profile_effective_config(profile.as_deref(), &cwd, &overrides)
        .await
    {
        Ok(effective) => effective,
        Err(error) => {
            return send_error(
                sender,
                &envelope.id,
                "INVALID_OVERRIDES",
                &error.to_string(),
            )
        }
    };
    if unsafe_unresolved_effort_reset(patch, &previous_overrides, &effective, has_runtime_state) {
        return send_error(
            sender,
            &envelope.id,
            "INHERITED_EFFORT_UNRESOLVED",
            "Cannot safely reset reasoning effort for this resumed session. Configure an explicit default reasoning effort in the provider configuration first.",
        );
    }
    if let Err(error) = WsSessionPersistence::update_runtime_overrides_static(
        &app_state.write_pool,
        session_id,
        &overrides,
    )
    .await
    {
        return send_error(sender, &envelope.id, "DB_ERROR", &error.to_string());
    }
    apply_to_handle(sdk_sessions, session_id, &overrides).await;
    super::reply_and_broadcast(
        app_state,
        sender,
        &envelope.id,
        feature_id,
        WsSessionAction::RuntimeOverridesChanged,
        RuntimeOverridesChangedPayload {
            runtime_overrides: overrides,
            effective,
        },
    )
    .await;
}

async fn override_snapshot(
    sessions: &SdkSessions,
    session_id: i64,
) -> Result<
    (
        i64,
        String,
        Option<String>,
        std::path::PathBuf,
        bool,
        RuntimeConfigOverrides,
    ),
    (),
> {
    let sessions = sessions.lock().await;
    let handle = sessions.get(&session_id).ok_or(())?;
    let has_runtime_state = handle.resume_session_id.is_some()
        || matches!(handle.state, super::super::QueryState::Active { .. })
        || matches!(&handle.state, super::super::QueryState::Pending(options) if options.resume_session_id.is_some());
    Ok((
        handle.feature_id,
        handle.runtime_provider.clone(),
        handle.config.claude_profile.clone(),
        handle.config.cwd.clone(),
        has_runtime_state,
        handle.config.overrides.clone(),
    ))
}

fn unsafe_unresolved_effort_reset(
    patch: &serde_json::Map<String, serde_json::Value>,
    previous: &RuntimeConfigOverrides,
    effective: &crate::domain::agents::adapter::RuntimeEffectiveConfig,
    has_runtime_state: bool,
) -> bool {
    let clears_effort = patch
        .get("thinking_effort")
        .is_some_and(serde_json::Value::is_null);
    let changes_model_while_effort_inherited = patch.contains_key("model")
        && !patch.contains_key("thinking_effort")
        && previous.thinking_effort.is_none();
    has_runtime_state
        && effective.thinking_effort.is_none()
        && (clears_effort || changes_model_while_effort_inherited)
        && (previous.thinking_effort.is_some() || previous.model.is_some())
}

fn apply_patch(
    overrides: &mut RuntimeConfigOverrides,
    patch: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(value) = patch.get("model") {
        overrides.model = nullable_string(value).map_err(|()| "model must be string or null")?;
    }
    if let Some(value) = patch.get("thinking_effort") {
        overrides.thinking_effort =
            nullable_string(value).map_err(|()| "thinking_effort must be string or null")?;
    }
    if let Some(value) = patch.get("fast_mode") {
        overrides.fast_mode = if value.is_null() {
            None
        } else {
            value.as_bool()
        };
        if !value.is_null() && overrides.fast_mode.is_none() {
            return Err("fast_mode must be boolean or null".to_string());
        }
    }
    Ok(())
}

async fn apply_to_handle(
    sessions: &SdkSessions,
    session_id: i64,
    overrides: &RuntimeConfigOverrides,
) {
    let mut sessions = sessions.lock().await;
    let Some(handle) = sessions.get_mut(&session_id) else {
        return;
    };
    handle.config.overrides = overrides.clone();
    handle.config.runtime_overrides_dirty = true;
    handle.desired_model = overrides.model.clone();
    handle.desired_thinking_effort = overrides.thinking_effort.clone();
    if let Some(fast_mode) = overrides.fast_mode {
        handle.config.fast_mode = fast_mode;
    }
    if let super::super::QueryState::Pending(options) = &mut handle.state {
        options.overrides = overrides.clone();
        options.model = overrides.model.clone();
        options.thinking_effort = overrides.thinking_effort.clone();
        if let Some(fast_mode) = overrides.fast_mode {
            options.fast_mode = fast_mode;
        }
    }
}

fn nullable_string(value: &serde_json::Value) -> Result<Option<String>, ()> {
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(|value| Some(value.to_string()))
        .ok_or(())
}

#[cfg(test)]
mod tests {
    use super::{nullable_string, unsafe_unresolved_effort_reset};
    use crate::domain::agents::adapter::{RuntimeConfigOverrides, RuntimeEffectiveConfig};

    #[test]
    fn nullable_string_preserves_reset_and_explicit_value() {
        assert_eq!(nullable_string(&serde_json::Value::Null), Ok(None));
        assert_eq!(
            nullable_string(&serde_json::json!("gpt-5.4")),
            Ok(Some("gpt-5.4".to_string()))
        );
        assert_eq!(nullable_string(&serde_json::json!(false)), Err(()));
    }

    #[test]
    fn resumed_unknown_effort_reset_fails_closed() {
        let patch = serde_json::json!({"thinking_effort": null})
            .as_object()
            .unwrap()
            .clone();
        let previous = RuntimeConfigOverrides {
            thinking_effort: Some("high".to_string()),
            ..Default::default()
        };
        assert!(unsafe_unresolved_effort_reset(
            &patch,
            &previous,
            &RuntimeEffectiveConfig::default(),
            true,
        ));
        assert!(!unsafe_unresolved_effort_reset(
            &patch,
            &previous,
            &RuntimeEffectiveConfig::default(),
            false,
        ));
    }
}
