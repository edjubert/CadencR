use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Router,
};

use std::num::ParseIntError;

use crate::{app_state::AppState, domain::neovim::protocol::{NeovimStartResponse, PullBufferRequest, PullBufferResponse, PushBufferRequest}, error::AppError};

/// POST /api/features/{feature_id}/neovim/start
///
/// Spawns a headless Neovim instance for the given feature (session).
/// Returns the spawn status and process info once the handshake completes.
#[utoipa::path(
    post,
    path = "/api/features/{feature_id}/neovim/start",
    params(("feature_id" = String, Path, description = "Feature ID")),
    responses((status = 200, description = "Neovim spawn result", body = NeovimStartResponse)),
)]
pub async fn start_route(
    State(app_state): State<AppState>,
    Path(feature_id): Path<String>,
) -> Result<(StatusCode, axum::Json<NeovimStartResponse>), AppError> {
    let feature_id: i64 = feature_id.parse().map_err(|e: ParseIntError| AppError::BadRequest(
        format!("Invalid feature_id: {e}"),
    ))?;
    let result = app_state.neovim_manager.start(feature_id).await?;
    Ok((StatusCode::OK, axum::Json(result)))
}

/// POST /api/features/{feature_id}/neovim/stop
///
/// Stops the headless Neovim instance for the given feature (session).
#[utoipa::path(
    post,
    path = "/api/features/{feature_id}/neovim/stop",
    params(("feature_id" = String, Path, description = "Feature ID")),
    responses((status = 200, description = "Neovim stopped successfully")),
)]
pub async fn stop_route(
    State(app_state): State<AppState>,
    Path(feature_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let feature_id: i64 = feature_id.parse().map_err(|e: ParseIntError| AppError::BadRequest(
        format!("Invalid feature_id: {e}"),
    ))?;
    match app_state.neovim_manager.stop(feature_id).await {
        Ok(()) => Ok(StatusCode::OK),
        Err(AppError::NeovimNotRunning { .. }) => Ok(StatusCode::OK),
        Err(e) => Err(e),
    }
}

/// POST /api/features/{feature_id}/neovim/buffer/push
///
/// Pushes file content from the workspace into the Neovim buffer.
#[utoipa::path(
    post,
    path = "/api/features/{feature_id}/neovim/buffer/push",
    params(("feature_id" = String, Path, description = "Feature ID")),
    request_body = PushBufferRequest,
    responses((status = 204, description = "Buffer pushed successfully")),
)]
pub async fn push_buffer_route(
    State(app_state): State<AppState>,
    Path(feature_id): Path<String>,
    axum::Json(request): axum::Json<PushBufferRequest>,
) -> Result<StatusCode, AppError> {
    let feature_id: i64 = feature_id.parse().map_err(|e: ParseIntError| AppError::BadRequest(
        format!("Invalid feature_id: {e}"),
    ))?;
    app_state
        .neovim_manager
        .push_buffer(feature_id, &request.file_path, &request.content)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/features/{feature_id}/neovim/buffer/pull
///
/// Pulls content from a Neovim buffer back to the workspace.
#[utoipa::path(
    post,
    path = "/api/features/{feature_id}/neovim/buffer/pull",
    params(("feature_id" = String, Path, description = "Feature ID")),
    request_body = PullBufferRequest,
    responses((status = 200, description = "Buffer pulled successfully", body = PullBufferResponse)),
)]
pub async fn pull_buffer_route(
    State(app_state): State<AppState>,
    Path(feature_id): Path<String>,
    axum::Json(request): axum::Json<PullBufferRequest>,
) -> Result<axum::Json<PullBufferResponse>, AppError> {
    let feature_id: i64 = feature_id.parse().map_err(|e: ParseIntError| AppError::BadRequest(
        format!("Invalid feature_id: {e}"),
    ))?;
    let content = app_state
        .neovim_manager
        .pull_buffer(feature_id, &request.file_path)
        .await?;
    Ok(axum::Json(PullBufferResponse { content }))
}

/// Register neovim routes on the router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/features/{feature_id}/neovim/start", post(start_route))
        .route("/api/features/{feature_id}/neovim/stop", post(stop_route))
        .route("/api/features/{feature_id}/neovim/buffer/push", post(push_buffer_route))
        .route("/api/features/{feature_id}/neovim/buffer/pull", post(pull_buffer_route))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify the routes module compiles and routes() returns a valid Router.
    #[test]
    fn routes_module_exists_and_returns_router() {
        let _router: Router<AppState> = routes();
    }
}
