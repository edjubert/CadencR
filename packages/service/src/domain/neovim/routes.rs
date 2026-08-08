use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::post,
    Router,
};

use crate::{app_state::AppState, domain::neovim::protocol::NeovimStartResponse, error::AppError};

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
    let result = app_state.neovim_manager.start(&feature_id).await?;
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
    app_state.neovim_manager.stop(&feature_id).await?;
    Ok(StatusCode::OK)
}

/// Register neovim routes on the router.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/features/{feature_id}/neovim/start", post(start_route))
        .route("/api/features/{feature_id}/neovim/stop", post(stop_route))
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
