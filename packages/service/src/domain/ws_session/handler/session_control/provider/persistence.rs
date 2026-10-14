use super::selection::SwitchSelection;
use super::switch::ProviderSetError;
use crate::domain::agents::adapter::access_mode_wire;

pub(super) async fn persist(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    selection: &SwitchSelection,
) -> Result<(), sqlx::Error> {
    let config = &selection.runtime;
    let overrides = serde_json::to_string(&config.overrides).expect("runtime overrides serialize");
    sqlx::query(
        "UPDATE agent_sessions SET runtime_provider = ?, model = ?, profile = ?, runtime_overrides = ?,
         thinking_effort = ?, fast_mode = ?, codex_permission_mode = ?, permission_mode = ? WHERE id = ?",
    )
    .bind(&selection.provider)
    .bind(&config.model)
    .bind(&config.profile)
    .bind(overrides)
    .bind(&config.thinking_effort)
    .bind(config.fast_mode)
    .bind(config.access_mode.as_ref().map(access_mode_wire).unwrap_or("default"))
    .bind(&selection.permission_mode_wire)
    .bind(session_id)
    .execute(pool).await?;
    Ok(())
}

/// Every column changed by `persist`, captured for rejection recovery.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub(crate) struct PersistedSelection {
    pub(crate) runtime_provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) profile: Option<String>,
    pub(crate) runtime_overrides: Option<String>,
    pub(crate) thinking_effort: Option<String>,
    pub(crate) codex_permission_mode: String,
    pub(crate) permission_mode: Option<String>,
    pub(crate) fast_mode: bool,
}

pub(crate) async fn read_persisted_selection(
    pool: &sqlx::SqlitePool,
    session_id: i64,
) -> Result<PersistedSelection, sqlx::Error> {
    sqlx::query_as(
        "SELECT runtime_provider, model, profile, runtime_overrides, thinking_effort,
         codex_permission_mode, permission_mode, fast_mode FROM agent_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_one(pool)
    .await
}

pub(crate) async fn restore_persisted_selection(
    pool: &sqlx::SqlitePool,
    session_id: i64,
    previous: &PersistedSelection,
) -> Result<(), ProviderSetError> {
    sqlx::query(
        "UPDATE agent_sessions SET runtime_provider = ?, model = ?, profile = ?, runtime_overrides = ?,
         thinking_effort = ?, codex_permission_mode = ?, permission_mode = ?, fast_mode = ? WHERE id = ?",
    )
    .bind(&previous.runtime_provider).bind(&previous.model).bind(&previous.profile)
    .bind(&previous.runtime_overrides).bind(&previous.thinking_effort)
    .bind(&previous.codex_permission_mode).bind(&previous.permission_mode)
    .bind(previous.fast_mode).bind(session_id).execute(pool).await.map_err(|error| {
        tracing::error!(session_id, %error, "failed to restore runtime selection after rejected switch");
        ProviderSetError::new("DB_ERROR", "Provider change was rejected, but the previous runtime selection could not be restored")
    })?;
    Ok(())
}
