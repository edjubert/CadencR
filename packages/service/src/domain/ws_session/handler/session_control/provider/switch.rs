use super::super::super::types::{QueryState, SdkSessions, SessionConfig};
use super::selection::SwitchSelection;
use crate::domain::agents::adapter::RuntimeSpawnConfig;
use crate::domain::ws_session::protocol::ProviderSetPayload;

pub(crate) struct ProviderSetError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl ProviderSetError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub(crate) fn locked() -> Self {
        Self::new(
            "PROVIDER_LOCKED",
            "Provider cannot be changed after the conversation starts",
        )
    }
    pub(crate) fn session_not_found() -> Self {
        Self::new("SESSION_NOT_FOUND", "Session not found")
    }
}

pub(super) struct SwitchSnapshot {
    pub provider: String,
    pub model: Option<String>,
    pub config: SessionConfig,
}

impl SwitchSnapshot {
    pub fn unchanged(&self, payload: &ProviderSetPayload) -> bool {
        self.provider == payload.provider
            && payload
                .model
                .as_deref()
                .is_none_or(|model| Some(model) == self.model.as_deref())
    }

    pub fn into_runtime(self) -> RuntimeSpawnConfig {
        RuntimeSpawnConfig {
            cwd: self.config.cwd,
            model: self.model,
            permission_mode: self.config.permission_mode,
            access_mode: self.config.access_mode,
            thinking_effort: self.config.thinking_effort,
            fast_mode: self.config.fast_mode,
            system_prompt: self.config.system_prompt,
            allow_bypass_permissions: self.config.allow_bypass_permissions,
            env: self.config.env,
            env_unset: self.config.env_unset,
            profile: self.config.claude_profile,
            overrides: self.config.overrides,
            profile_revision: self.config.profile_revision,
            profile_state_identity: self.config.profile_state_identity,
            ..Default::default()
        }
    }
}

pub(super) async fn snapshot(
    sessions: &SdkSessions,
    session_id: i64,
) -> Result<SwitchSnapshot, ProviderSetError> {
    let sessions = sessions.lock().await;
    let handle = sessions
        .get(&session_id)
        .ok_or_else(ProviderSetError::session_not_found)?;
    if !matches!(handle.state, QueryState::Pending(_)) {
        return Err(ProviderSetError::locked());
    }
    let mut config = handle.config.clone();
    config.permission_mode = handle.desired_permission_mode.clone();
    config.access_mode = handle.desired_access_mode.clone();
    config.thinking_effort = handle.desired_thinking_effort.clone();
    config.claude_profile = handle.desired_claude_profile.clone();
    Ok(SwitchSnapshot {
        provider: handle.runtime_provider.clone(),
        model: handle.desired_model.clone(),
        config,
    })
}

pub(super) async fn ensure_still_pending(
    sessions: &SdkSessions,
    session_id: i64,
) -> Result<(), ProviderSetError> {
    snapshot(sessions, session_id).await.map(|_| ())
}

pub(super) async fn commit_switch(
    sessions: &SdkSessions,
    session_id: i64,
    selection: SwitchSelection,
) -> Result<i64, ProviderSetError> {
    let mut sessions = sessions.lock().await;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(ProviderSetError::session_not_found)?;
    if !matches!(handle.state, QueryState::Pending(_)) {
        return Err(ProviderSetError::locked());
    }
    let config = selection.runtime;
    handle.runtime_provider = selection.provider;
    handle.resume_session_id = None;
    handle.desired_model = config.model.clone();
    handle.desired_permission_mode = config.permission_mode.clone();
    handle.desired_access_mode = config.access_mode.clone();
    handle.desired_thinking_effort = config.thinking_effort.clone();
    handle.desired_claude_profile = config.profile.clone();
    handle.config = SessionConfig::from_runtime(&config, config.profile.clone());
    handle.state = QueryState::Pending(config);
    Ok(handle.feature_id)
}
