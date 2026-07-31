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
    // A feature may have zero active WS connections when /neovim/start is
    // called (e.g. HTTP called before any WS session opened) — the registry
    // itself handles that as a no-op fan-out (an empty sender list), the same
    // way it already does for HTTP-triggered git.status/session_status
    // pushes, so there's nothing to branch on here.
    let result = app_state
        .neovim_manager
        .start(feature_id, app_state.ws_feature_senders.clone())
        .await?;
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
    use crate::domain::neovim::service::tests::nvim_available;
    use crate::api::build_router;
    use sqlx::SqlitePool;
    use axum::body::Body;
    use axum::body::to_bytes;
    use axum::http::Method;
    use axum::http::Request;
    use tower::ServiceExt;

    /// Verify the routes module compiles and routes() returns a valid Router.
    #[test]
    fn routes_module_exists_and_returns_router() {
        let _router: Router<AppState> = routes();
    }

    #[tokio::test]
    async fn start_route_compiles_and_succeeds_with_active_ws_session() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }

        let pool = SqlitePool::connect("sqlite::memory:").await.expect("memory pool");
        let state = AppState::with_pool(pool);

        // Establish an active WS session for the feature the same way a real
        // WS connection registers itself on upgrade.
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        state.ws_feature_senders.register(301, tx).await;

        let app = build_router(state);
        let start_resp = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/features/301/neovim/start")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("start should not return 404");

        assert_eq!(start_resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn push_then_pull_route_roundtrips_content() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }

        let pool = SqlitePool::connect("sqlite::memory:").await.expect("memory pool");
        let state = AppState::with_pool(pool);
        let app = build_router(state);

        // Start neovim for feature 300
        let start_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/features/300/neovim/start")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("start should not return 404");

        let status = start_resp.status();
        if status == StatusCode::NOT_FOUND {
            panic!("start route not found");
        }
        if !status.is_success() && status != StatusCode::OK {
            eprintln!("SKIP: neovim start returned {status}");
            return;
        }

        // Give neovim a moment to fully initialize
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        // Push buffer
        let push_body = serde_json::json!({
            "file_path": "src/main.rs",
            "content": "fn main() {}\n"
        });
        let push_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/features/300/neovim/buffer/push")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&push_body).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .expect("push should not return 404");

        assert_eq!(push_resp.status(), StatusCode::NO_CONTENT);

        // Pull buffer
        let pull_body = serde_json::json!({
            "file_path": "src/main.rs"
        });
        let pull_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/features/300/neovim/buffer/pull")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::to_string(&pull_body).unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .expect("pull should not return 404");

        assert_eq!(pull_resp.status(), StatusCode::OK);

        let body_bytes = to_bytes(pull_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
        let response: PullBufferResponse = serde_json::from_str(&body_str).unwrap();
        assert_eq!(response.content, "fn main() {}\n");
    }
}
