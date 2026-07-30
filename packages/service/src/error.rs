use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}

#[derive(Debug)]
pub enum AppError {
    DatabaseError(String),
    GitCommandError(String),
    NotFound(String),
    BadRequest(String),
    Internal(String),
    Conflict(String),
    /// 503 — a downstream resource is temporarily unhealthy. Used by the
    /// LSP host's crash-backoff to signal "retry later", matching the
    /// semantics web clients already understand.
    ServiceUnavailable(String),
    #[allow(dead_code)]
    NeovimSpawnError {
        detail: String,
    },
    #[allow(dead_code)]
    NeovimHandshakeTimeout,
    #[allow(dead_code)]
    NeovimNotRunning {
        feature_id: String,
    },
    #[allow(dead_code)]
    NeovimBufferNotFound {
        file_path: String,
    },
    #[allow(dead_code)]
    NeovimProcessNotRunning,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::DatabaseError(msg) => write!(f, "Database error: {msg}"),
            AppError::GitCommandError(msg) => write!(f, "Git command error: {msg}"),
            AppError::NotFound(msg) => write!(f, "Not found: {msg}"),
            AppError::BadRequest(msg) => write!(f, "Bad request: {msg}"),
            AppError::Internal(msg) => write!(f, "Internal error: {msg}"),
            AppError::Conflict(msg) => write!(f, "Conflict: {msg}"),
            AppError::ServiceUnavailable(msg) => write!(f, "Service unavailable: {msg}"),
            AppError::NeovimSpawnError { detail } => {
                write!(f, "failed to spawn neovim process: {detail}")
            }
            AppError::NeovimHandshakeTimeout => {
                write!(f, "neovim process did not complete handshake in time")
            }
            AppError::NeovimNotRunning { feature_id } => {
                write!(f, "neovim not running for feature {feature_id}")
            }
            AppError::NeovimBufferNotFound { file_path } => {
                write!(f, "no neovim buffer found for path: {file_path}")
            }
            AppError::NeovimProcessNotRunning => {
                write!(f, "no neovim process is running for this feature")
            }
        }
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::DatabaseError(_) => (StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
            AppError::GitCommandError(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "GIT_COMMAND_ERROR")
            }
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "BAD_REQUEST"),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "CONFLICT"),
            AppError::ServiceUnavailable(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE")
            }
            AppError::NeovimSpawnError { .. } => {
                (StatusCode::INTERNAL_SERVER_ERROR, "NEOVIM_NOT_FOUND")
            }
            AppError::NeovimHandshakeTimeout => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "NEOVIM_HANDSHAKE_TIMEOUT",
            ),
            AppError::NeovimNotRunning { .. } => (StatusCode::NOT_FOUND, "NEOVIM_NOT_RUNNING"),
            AppError::NeovimBufferNotFound { .. } => {
                (StatusCode::NOT_FOUND, "NEOVIM_BUFFER_NOT_FOUND")
            }
            AppError::NeovimProcessNotRunning => (
                StatusCode::CONFLICT,
                "NEOVIM_PROCESS_NOT_RUNNING",
            ),
        };

        if status.is_server_error() {
            tracing::error!(code = code, error = %self, "request failed");
        }

        let public_error = if status == StatusCode::INTERNAL_SERVER_ERROR {
            "Internal server error".to_string()
        } else {
            self.to_string()
        };
        let body = ErrorResponse {
            error: public_error,
            code: code.to_string(),
        };

        (status, axum::Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::DatabaseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::IntoResponse;

    #[test]
    fn test_not_found_returns_404() {
        let err = AppError::NotFound("missing".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_bad_request_returns_400() {
        let err = AppError::BadRequest("invalid".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_internal_returns_500() {
        let err = AppError::Internal("boom".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn neovim_spawn_error_returns_500_with_correct_code() {
        let response = AppError::NeovimSpawnError {
            detail: "nvim: command not found".into(),
        }
        .into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("decode response");
        assert_eq!(parsed["code"], "NEOVIM_NOT_FOUND");
    }

    #[tokio::test]
    async fn neovim_handshake_timeout_returns_500_with_correct_code() {
        let response = AppError::NeovimHandshakeTimeout.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("decode response");
        assert_eq!(parsed["code"], "NEOVIM_HANDSHAKE_TIMEOUT");
    }

    #[tokio::test]
    async fn neovim_not_running_returns_404() {
        let response = AppError::NeovimNotRunning {
            feature_id: "42".into(),
        }
        .into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("decode response");
        assert_eq!(parsed["code"], "NEOVIM_NOT_RUNNING");
    }

    #[tokio::test]
    async fn internal_error_body_does_not_expose_details() {
        let response =
            AppError::DatabaseError("SELECT secret FROM private_table".into()).into_response();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let body: serde_json::Value =
            serde_json::from_slice(&bytes).expect("decode error response");

        assert_eq!(body["error"], "Internal server error");
        assert_eq!(body["code"], "DATABASE_ERROR");
        assert!(!body["error"].as_str().unwrap().contains("SELECT"));
    }

    #[tokio::test]
    async fn neovim_buffer_not_found_returns_404_with_correct_code() {
        let response = AppError::NeovimBufferNotFound {
            file_path: "src/main.rs".into(),
        }
        .into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("decode response");
        assert_eq!(parsed["code"], "NEOVIM_BUFFER_NOT_FOUND");
    }

    #[tokio::test]
    async fn neovim_process_not_running_returns_409_with_correct_code() {
        let response = AppError::NeovimProcessNotRunning.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("decode response");
        assert_eq!(parsed["code"], "NEOVIM_PROCESS_NOT_RUNNING");
    }
}
