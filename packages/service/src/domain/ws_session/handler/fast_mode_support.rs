use std::path::Path;

use crate::app_state::AppState;
use crate::domain::agents::providers::resolve_model_or_error_for_profile;

pub(super) struct FastModeTarget<'a> {
    pub(super) provider: &'a str,
    pub(super) model: Option<&'a str>,
    pub(super) cwd: &'a Path,
    pub(super) profile: Option<&'a str>,
}

pub(super) async fn model_supports_fast_mode(
    app_state: &AppState,
    target: FastModeTarget<'_>,
) -> bool {
    let Some(model) = target.model else {
        return false;
    };
    resolve_model_or_error_for_profile(
        &app_state.read_pool,
        Some(target.cwd),
        target.provider,
        model,
        target.profile,
    )
    .await
    .is_ok_and(|(_, entry)| entry.supports_fast_mode == Some(true))
}
