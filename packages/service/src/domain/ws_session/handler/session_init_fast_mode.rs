use std::path::Path;

use tracing::warn;

use super::super::fast_mode_support::{model_supports_fast_mode, FastModeTarget};
use crate::app_state::AppState;
use crate::domain::ws_session::persistence::WsSessionPersistence;

pub(super) struct RestoreFastModeOptions<'a> {
    pub(super) db_session_id: i64,
    pub(super) provider: &'a str,
    pub(super) model: Option<&'a str>,
    pub(super) cwd: &'a Path,
    pub(super) profile: Option<&'a str>,
    pub(super) stored_fast_mode: bool,
}

pub(super) async fn resolve(
    app_state: &AppState,
    options: RestoreFastModeOptions<'_>,
) -> Result<bool, sqlx::Error> {
    if !options.stored_fast_mode {
        return Ok(false);
    }
    let supported = model_supports_fast_mode(
        app_state,
        FastModeTarget {
            provider: options.provider,
            model: options.model,
            cwd: options.cwd,
            profile: options.profile,
        },
    )
    .await;
    let (enabled, clear_stored) = normalize_restored_fast_mode(options.stored_fast_mode, supported);
    if !clear_stored {
        return Ok(enabled);
    }

    warn!(
        db_session_id = options.db_session_id,
        runtime_provider = %options.provider,
        model = ?options.model,
        "clearing fast mode unsupported by selected model"
    );
    WsSessionPersistence::update_fast_mode_static(
        &app_state.write_pool,
        options.db_session_id,
        false,
    )
    .await?;
    Ok(false)
}

fn normalize_restored_fast_mode(stored: bool, supported: bool) -> (bool, bool) {
    if stored && supported {
        return (true, false);
    }
    (false, stored)
}

#[cfg(test)]
mod tests {
    use super::normalize_restored_fast_mode;

    #[test]
    fn clears_a_restored_value_when_capability_is_gone() {
        assert_eq!(normalize_restored_fast_mode(true, false), (false, true));
        assert_eq!(normalize_restored_fast_mode(true, true), (true, false));
        assert_eq!(normalize_restored_fast_mode(false, true), (false, false));
    }
}
