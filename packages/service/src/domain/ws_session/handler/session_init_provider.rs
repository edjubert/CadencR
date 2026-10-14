use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeAccessMode;
use crate::domain::agents::{default_provider_id, runtime::runtime_setting_key};
use crate::domain::settings;

pub(super) async fn resolve(
    app_state: &AppState,
    feature_id: i64,
    project_id: i64,
    requested_provider: Option<&str>,
) -> (String, Option<RuntimeAccessMode>) {
    let configured = settings::resolve_setting(
        &app_state.read_pool,
        &runtime_setting_key("session"),
        Some(feature_id),
        Some(project_id),
        Some(default_provider_id()),
    )
    .await
    .unwrap_or_else(|| default_provider_id().to_string());
    let provider = requested_provider.map(str::to_string).unwrap_or(configured);
    let access_mode = crate::domain::ws_session::handler::access::configured_access_mode(
        &provider,
        &app_state.read_pool,
    )
    .await;
    (provider, access_mode)
}
