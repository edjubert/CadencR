use axum::extract::{Json, State};
use axum::routing::get;
use axum::Router;

use crate::app_state::AppState;
use crate::domain::ports::models::FeaturePorts;
use crate::domain::ports::service;
use crate::error::AppError;

/// Global rather than project-scoped: the scan is machine-wide either way, and
/// one shared query key keeps a multi-project sidebar to a single poll.
#[utoipa::path(get, path = "/api/features/ports",
    responses((status = 200, body = Vec<FeaturePorts>)))]
pub async fn list_feature_ports_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<FeaturePorts>>, AppError> {
    Ok(Json(service::feature_ports(&state).await?))
}

pub fn ports_router() -> Router<AppState> {
    Router::new().route("/api/features/ports", get(list_feature_ports_handler))
}
