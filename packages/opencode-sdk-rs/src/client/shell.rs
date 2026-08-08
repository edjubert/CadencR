use serde_json::Value;

use super::{ensure_success, OpenCodeClient};
use crate::error::SdkError;

#[bon::bon]
impl OpenCodeClient {
    /// `POST /session/{id}/shell` — run a user shell command through
    /// OpenCode's native session route. OpenCode persists the synthetic user
    /// record and Bash part in the provider conversation before execution.
    #[builder]
    pub async fn shell_command(
        &self,
        session_id: &str,
        agent: &str,
        command: &str,
        directory: Option<&str>,
    ) -> Result<Value, SdkError> {
        let response = self
            .maybe_scoped_request(
                self.http
                    .post(format!("{}/session/{session_id}/shell", self.base_url))
                    .json(&serde_json::json!({
                        "agent": agent,
                        "command": command,
                    })),
                directory,
            )
            .send()
            .await?;
        ensure_success(response).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::extract::{Path, State};
    use axum::http::{HeaderMap, Uri};
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::{json, Value};
    use tokio::net::TcpListener;

    use super::OpenCodeClient;

    #[derive(Clone, Default)]
    struct RequestState(Arc<Mutex<Vec<(String, Value)>>>);

    async fn record_shell(
        State(state): State<RequestState>,
        Path(id): Path<String>,
        uri: Uri,
        headers: HeaderMap,
        Json(body): Json<Value>,
    ) -> Json<Value> {
        let directory = headers
            .get("x-opencode-directory")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        state
            .0
            .lock()
            .unwrap()
            .push((format!("{id} {uri} header={directory}"), body));
        Json(json!({}))
    }

    #[tokio::test]
    async fn sends_agent_command_and_directory_scope() {
        let state = RequestState::default();
        let app = Router::new()
            .route("/session/{id}/shell", post(record_shell))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client =
            OpenCodeClient::with_base_url(format!("http://{}", listener.local_addr().unwrap()));
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        client
            .shell_command()
            .session_id("ses_1")
            .agent("plan")
            .command("printf hello | cat")
            .directory("/tmp/project")
            .call()
            .await
            .expect("shell command");

        let requests = state.0.lock().unwrap();
        assert_eq!(
            requests[0].0,
            "ses_1 /session/ses_1/shell?directory=%2Ftmp%2Fproject header=/tmp/project"
        );
        assert_eq!(
            requests[0].1,
            json!({ "agent": "plan", "command": "printf hello | cat" })
        );
    }
}
