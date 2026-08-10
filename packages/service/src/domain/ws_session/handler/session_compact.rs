use axum::extract::ws::Message;

use super::super::protocol::*;
use super::session_compact_pending::spawn_pending_runtime_for_compact;
use super::{parse_session_id, send_error, QueryState, SdkHandle, SdkSessions, WsSender};
use crate::app_state::AppState;
use crate::domain::agents::adapter::RuntimeCompactionStrategy;
use crate::domain::agents::runtime_adapter;

pub(super) async fn handle_compact(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let payload = match compact_payload(&envelope, sender) {
        Some(payload) => payload,
        None => return,
    };
    let db_session_id = match parse_session_id(&payload.session_id) {
        Some(id) => id,
        None => {
            send_error(
                sender,
                &envelope.id,
                "INVALID_SESSION_ID",
                "Invalid session_id",
            );
            return;
        }
    };

    match compaction_strategy(sdk_sessions, db_session_id).await {
        Ok(RuntimeCompactionStrategy::LiveRuntime) => {
            match persist_compact_command(
                app_state,
                sender,
                db_session_id,
                payload.message_uuid.as_deref(),
            )
            .await
            {
                Ok(true) => {}
                Ok(false) => {
                    if let Err(error) = send_compact_started(sender, &envelope.id) {
                        tracing::warn!(error = %error, "compact.started reply delivery failed");
                    }
                    return;
                }
                Err(message) => {
                    send_error(
                        sender,
                        &envelope.id,
                        "USER_MESSAGE_PERSIST_FAILED",
                        &message,
                    );
                    return;
                }
            }
            handle_active_runtime_compact(
                &envelope.id,
                sender,
                sdk_sessions,
                db_session_id,
                Some(app_state),
            )
            .await;
        }
        Err(message) => send_error(sender, &envelope.id, "COMPACT_REJECTED", &message),
    }
}

async fn persist_compact_command(
    app_state: &AppState,
    sender: &WsSender,
    session_id: i64,
    message_uuid: Option<&str>,
) -> Result<bool, String> {
    let feature_id: i64 = sqlx::query_scalar("SELECT feature_id FROM agent_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_one(&app_state.read_pool)
        .await
        .map_err(|error| error.to_string())?;
    let message_uuid =
        crate::domain::sessions::user_messages::canonical_user_message_uuid(message_uuid)
            .map_err(|_| "message_uuid must be a valid UUID".to_string())?;
    let outcome = super::session_prompt::persist_and_publish_user_message(
        super::session_prompt::CanonicalUserMessageRequest {
            pool: &app_state.write_pool,
            feature_senders: &app_state.ws_feature_senders,
            owner: Some(sender),
            feature_id,
            session_id,
            content: "/compact",
            message_uuid,
            origin: None,
            mode: super::session_prompt::CanonicalUserMessageMode::PersistOnly,
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = outcome.delivery {
        tracing::warn!(feature_id, session_id, error = %error, "compact command owner disconnected");
    }
    let message = outcome.message;
    if message.inserted {
        app_state.feature_events_tx.emit(
            feature_id,
            None,
            crate::domain::feature_events::FeatureEventAction::Reordered,
        );
    }
    Ok(message.inserted)
}

fn compact_payload(envelope: &WsEnvelope, sender: &WsSender) -> Option<SessionActionPayload> {
    match serde_json::from_value(envelope.payload.clone()) {
        Ok(payload) => Some(payload),
        Err(error) => {
            send_error(sender, &envelope.id, "INVALID_PAYLOAD", &error.to_string());
            None
        }
    }
}

async fn compaction_strategy(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) -> Result<RuntimeCompactionStrategy, String> {
    let sessions = sdk_sessions.lock().await;
    let Some(handle) = sessions.get(&db_session_id) else {
        return Err("Session not found".to_string());
    };
    runtime_adapter(&handle.runtime_provider)
        .and_then(|adapter| adapter.compaction_strategy())
        .ok_or_else(|| "/compact is not supported for this provider".to_string())
}

async fn handle_active_runtime_compact(
    envelope_id: &str,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
    app_state: Option<&AppState>,
) {
    let query = {
        let sessions = sdk_sessions.lock().await;
        let Some(handle) = sessions.get(&db_session_id) else {
            send_error(
                sender,
                envelope_id,
                "SESSION_NOT_FOUND",
                "Session not found",
            );
            return;
        };
        match compact_target(handle) {
            CompactTarget::Active => {
                let QueryState::Active { query, .. } = &handle.state else {
                    unreachable!("compact_target returned active for non-active state");
                };
                query.clone()
            }
            CompactTarget::PendingSpawn => {
                let Some(app_state) = app_state else {
                    send_error(sender, envelope_id, "INVALID_STATE", "Session not active");
                    return;
                };
                drop(sessions);
                match spawn_pending_runtime_for_compact(
                    envelope_id,
                    sender,
                    sdk_sessions,
                    db_session_id,
                    app_state,
                )
                .await
                {
                    Some(spawned) => spawned,
                    None => return,
                }
            }
        }
    };

    if let Err(error) = query.read().await.compact().await {
        send_error(sender, envelope_id, "COMPACT_REJECTED", &error.to_string());
        return;
    }

    if let Err(error) = send_compact_started(sender, envelope_id) {
        tracing::warn!(error = %error, "compact.started reply delivery failed");
    }
}

fn send_compact_started(sender: &WsSender, envelope_id: &str) -> Result<(), String> {
    let reply = WsEnvelope::session_reply(
        envelope_id,
        WsSessionAction::CompactStarted,
        serde_json::Value::Null,
    )
    .expect("compact started payload should serialize");
    sender
        .send(Message::Text(String::from(reply).into()))
        .map_err(|_| "WebSocket connection closed before compact.started was delivered".to_string())
}

enum CompactTarget {
    Active,
    PendingSpawn,
}

impl CompactTarget {
    #[cfg(test)]
    fn is_pending_spawn(&self) -> bool {
        matches!(self, Self::PendingSpawn)
    }
}

fn compact_target(handle: &SdkHandle) -> CompactTarget {
    match handle.state {
        QueryState::Active { .. } => CompactTarget::Active,
        QueryState::Pending(_) => CompactTarget::PendingSpawn,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use async_trait::async_trait;
    use axum::extract::ws::Message;
    use serde_json::Value;
    use tokio::sync::{mpsc, Mutex};

    use super::{compact_target, compaction_strategy, handle_active_runtime_compact};
    use crate::domain::agents::adapter::{
        AgentRuntimeSession, RuntimeCompactionStrategy, RuntimeError, RuntimeEvent,
        RuntimePermissionMode, RuntimeSpawnConfig,
    };
    use crate::domain::ws_session::handler::{QueryState, SdkHandle, SdkSessions, SessionConfig};

    struct CompactRuntime {
        fail: bool,
    }

    #[async_trait]
    impl AgentRuntimeSession for CompactRuntime {
        fn take_message_rx(&mut self) -> crate::domain::agents::adapter::RuntimeMessageRx {
            let (_tx, rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
            rx
        }
        async fn session_id(&self) -> Option<String> {
            Some("runtime".to_string())
        }
        async fn stream_input(&self, _content: Value) -> Result<(), RuntimeError> {
            Ok(())
        }
        async fn interrupt(&self) -> Result<(), RuntimeError> {
            Ok(())
        }
        async fn compact(&self) -> Result<(), RuntimeError> {
            if self.fail {
                Err(RuntimeError::new("compact failed"))
            } else {
                Ok(())
            }
        }
        async fn close(&mut self) {}
        async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
            Ok(())
        }
        async fn set_permission_mode(
            &self,
            _mode: RuntimePermissionMode,
        ) -> Result<(), RuntimeError> {
            Ok(())
        }
        fn pid(&self) -> Option<u32> {
            None
        }
    }

    fn handle_for_provider(provider: &str, state: QueryState) -> SdkHandle {
        SdkHandle {
            state,
            feature_id: 1,
            runtime_provider: provider.to_string(),
            desired_model: None,
            spawned_model: None,
            desired_permission_mode: None,
            spawned_permission_mode: None,
            desired_access_mode: None,
            spawned_access_mode: None,
            desired_thinking_effort: None,
            spawned_thinking_effort: None,
            desired_claude_profile: None,
            spawned_claude_profile: None,
            runtime_control_endpoint: None,
            resume_session_id: None,
            config: SessionConfig {
                cwd: PathBuf::new(),
                canonical_cwd: PathBuf::new(),
                permission_mode: None,
                access_mode: None,
                thinking_effort: None,
                fast_mode: false,
                system_prompt: None,
                allow_bypass_permissions: false,
                claude_profile: None,
                env: None,
            },
            manual_compact_cancel: Arc::new(AtomicBool::new(false)),
            manual_compact_spawn_pending: Arc::new(AtomicBool::new(false)),
        }
    }

    #[tokio::test]
    async fn compaction_strategy_returns_live_runtime_for_all_providers() {
        // Both supported providers (Codex / OpenCode-ACP) compact via the
        // live runtime path. SummaryReplay was the legacy OpenCode HTTP
        // strategy and is gone with the removed long-lived transport.
        let sessions: SdkSessions = Arc::new(Mutex::new(HashMap::from([
            (
                1,
                handle_for_provider(
                    crate::domain::agents::codex::PROVIDER_ID,
                    QueryState::Pending(RuntimeSpawnConfig::default()),
                ),
            ),
            (
                2,
                handle_for_provider(
                    crate::domain::agents::opencode::PROVIDER_ID,
                    QueryState::Pending(RuntimeSpawnConfig::default()),
                ),
            ),
        ])));

        assert_eq!(
            compaction_strategy(&sessions, 1).await.unwrap(),
            RuntimeCompactionStrategy::LiveRuntime
        );
        assert_eq!(
            compaction_strategy(&sessions, 2).await.unwrap(),
            RuntimeCompactionStrategy::LiveRuntime
        );
    }

    #[test]
    fn pending_runtime_sessions_are_spawnable_for_compact() {
        let handle = handle_for_provider(
            crate::domain::agents::codex::PROVIDER_ID,
            QueryState::Pending(RuntimeSpawnConfig {
                resume_session_id: Some("thread-1".to_string()),
                ..RuntimeSpawnConfig::default()
            }),
        );

        assert!(compact_target(&handle).is_pending_spawn());
    }

    fn active_sessions(fail: bool) -> SdkSessions {
        let (permission_tx, _permission_rx) = mpsc::channel(1);
        let runtime = Box::new(CompactRuntime { fail }) as Box<dyn AgentRuntimeSession>;
        Arc::new(Mutex::new(HashMap::from([(
            1,
            handle_for_provider(
                crate::domain::agents::opencode::PROVIDER_ID,
                QueryState::Active {
                    query: Arc::new(tokio::sync::RwLock::new(runtime)),
                    permission_tx,
                },
            ),
        )])))
    }

    #[tokio::test]
    async fn active_runtime_compact_sends_started_reply() {
        let (sender, mut rx) = mpsc::unbounded_channel();
        handle_active_runtime_compact("req-1", &sender, &active_sessions(false), 1, None).await;
        let message = rx.recv().await.unwrap();
        let Message::Text(text) = message else {
            panic!("expected text reply");
        };
        assert!(text.contains("compact.started"));
    }

    #[tokio::test]
    async fn active_runtime_compact_sends_error_reply() {
        let (sender, mut rx) = mpsc::unbounded_channel();
        handle_active_runtime_compact("req-2", &sender, &active_sessions(true), 1, None).await;
        let message = rx.recv().await.unwrap();
        let Message::Text(text) = message else {
            panic!("expected text reply");
        };
        assert!(text.contains("\"error\""));
        assert!(text.contains("compact failed"));
    }
}
