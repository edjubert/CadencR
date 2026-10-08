use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::agents::providers::runtime_adapter;
use crate::domain::agents::runtime_overrides::{self, RestoreOptions};
use crate::domain::ws_session::handler::session_runtime_config;
use crate::domain::ws_session::persistence::{SessionRow, WsSessionPersistence};

pub(super) struct ResolvedProfileConfig {
    pub effective_profile: Option<String>,
    pub effective_model: Option<String>,
    pub effective_thinking_effort: Option<String>,
    pub profile_effective_fast_mode: Option<bool>,
    pub inherits_profile_config: bool,
}

#[derive(bon::Builder)]
pub(super) struct ResolveOptions<'a> {
    app_state: &'a AppState,
    project_id: i64,
    feature_id: i64,
    db_session_id: i64,
    provider: &'a str,
    row: Option<&'a SessionRow>,
    stored_model: Option<&'a str>,
    stored_effort: Option<&'a str>,
    stored_fast_mode: bool,
    effective_model: Option<String>,
    effective_effort: Option<String>,
    runtime_config: &'a mut RuntimeSpawnConfig,
}

pub(super) async fn resolve(
    options: ResolveOptions<'_>,
) -> Result<ResolvedProfileConfig, (&'static str, String)> {
    let ResolveOptions {
        app_state,
        project_id,
        feature_id,
        db_session_id,
        provider,
        row,
        stored_model,
        stored_effort,
        stored_fast_mode,
        mut effective_model,
        mut effective_effort,
        runtime_config,
    } = options;
    runtime_config.overrides = runtime_overrides::restore(
        RestoreOptions::builder()
            .provider(provider)
            .maybe_runtime_session_id(row.and_then(|session| session.runtime_session_id.as_deref()))
            .maybe_stored_json(row.and_then(|session| session.runtime_overrides.as_deref()))
            .maybe_model(stored_model)
            .maybe_thinking_effort(stored_effort)
            .fast_mode(stored_fast_mode)
            .build(),
    )
    .map_err(|error| ("INVALID_RUNTIME_OVERRIDES", error))?;
    let inherits = runtime_adapter(provider)
        .is_some_and(|adapter| adapter.supports_profile_config_inheritance());
    if row.is_some_and(|session| session.runtime_overrides.is_none()) && inherits {
        WsSessionPersistence::update_runtime_overrides_static(
            &app_state.write_pool,
            db_session_id,
            &runtime_config.overrides,
        )
        .await
        .map_err(|error| ("DB_ERROR", error.to_string()))?;
    }
    let selected_profile = session_runtime_config::persisted_profile_selection(
        provider,
        row.and_then(|session| session.profile.as_deref()),
        row.and_then(|session| session.runtime_session_id.as_deref()),
        &runtime_config.cwd,
    )
    .await
    .map_err(|error| ("PROFILE_ERROR", error))?;
    let profile = session_runtime_config::apply_provider_settings(
        app_state,
        project_id,
        feature_id,
        db_session_id,
        provider,
        selected_profile.as_deref(),
        runtime_config,
    )
    .await
    .map_err(|error| ("PROFILE_ERROR", error))?;
    let mut effective_fast_mode = None;
    if let Some(adapter) =
        runtime_adapter(provider).filter(|adapter| adapter.supports_profile_config_inheritance())
    {
        let effective = adapter
            .resolve_profile_effective_config(
                profile.as_deref(),
                &runtime_config.cwd,
                &runtime_config.overrides,
            )
            .await
            .map_err(|error| ("PROFILE_CONFIG_ERROR", error.to_string()))?;
        effective_model = effective.model;
        effective_effort = effective.thinking_effort;
        runtime_config.model = effective_model.clone();
        runtime_config.thinking_effort = effective_effort.clone();
        runtime_config.fast_mode = effective.fast_mode;
        effective_fast_mode = Some(effective.fast_mode);
    }
    Ok(ResolvedProfileConfig {
        effective_profile: profile,
        effective_model,
        effective_thinking_effort: effective_effort,
        profile_effective_fast_mode: effective_fast_mode,
        inherits_profile_config: inherits,
    })
}
