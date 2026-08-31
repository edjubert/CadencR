//! Provider selection: `session.init` provider validation, `provider.set`
//! (including the Codex access-mode wiring) and the provider-lock guards.

use super::support::*;

#[tokio::test]
async fn test_init_rejects_unsupported_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_provider) VALUES (1, 'session', 'paused', 'not_a_provider')"
    )
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let envelope = make_envelope(
        "session",
        "init",
        serde_json::json!({
            "cwd": "/tmp/test",
            "feature_id": 1,
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "UNSUPPORTED_PROVIDER");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_init_accepts_opencode_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    sqlx::query(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, runtime_provider) VALUES (1, 'session', 'paused', 'opencode')"
    )
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let envelope = make_envelope(
        "session",
        "init",
        serde_json::json!({
            "cwd": "/tmp/test",
            "feature_id": 1,
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "initialized");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_init_preserves_base_system_prompt_for_opencode() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session_with_payload(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        SessionInitPayload {
            provider: Some("opencode".to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: Some("Base prompt".to_string()),
            cwd: Some("/tmp/test".to_string()),
            feature_id: Some(1),
        },
    )
    .await;

    let db_id: i64 = session_id.parse().unwrap();
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    let prompt = handle.config.system_prompt.as_deref().unwrap_or_default();
    assert_eq!(prompt, "Base prompt");
}

#[tokio::test]
async fn test_provider_set_updates_pending_session_and_persists_runtime_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "claude_code",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "provider.set.ok");
        assert_eq!(
            env.payload.get("provider").and_then(|v| v.as_str()),
            Some("claude_code")
        );
    } else {
        panic!("expected text message");
    }

    let db_id: i64 = session_id.parse().unwrap();
    let persisted: Option<String> =
        sqlx::query_scalar("SELECT runtime_provider FROM agent_sessions WHERE id = ?")
            .bind(db_id)
            .fetch_one(&app_state.read_pool)
            .await
            .unwrap();
    assert_eq!(persisted.as_deref(), Some("claude_code"));
}

#[tokio::test]
async fn test_provider_set_applies_a_model_change_on_the_same_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let db_id: i64 = session_id.parse().unwrap();
    {
        let sessions = sdk_sessions.lock().await;
        let handle = sessions.get(&db_id).unwrap();
        assert_eq!(handle.runtime_provider, "claude_code");
    }

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "claude_code",
            "model": "sonnet",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    let Message::Text(text) = msg else {
        panic!("expected text message");
    };
    let env: WsEnvelope = serde_json::from_str(&text).unwrap();
    assert_eq!(env.action, "provider.set.ok");
    assert_eq!(
        env.payload.get("model").and_then(|v| v.as_str()),
        Some("sonnet"),
        "same-provider model change must not be acknowledged with the stale model"
    );

    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(handle.desired_model.as_deref(), Some("sonnet"));
}

#[tokio::test]
async fn test_provider_set_rejects_unsupported_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "not_a_provider",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "UNSUPPORTED_PROVIDER");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_provider_set_accepts_opencode() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "opencode",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "provider.set.ok");
        assert_eq!(
            env.payload.get("provider").and_then(|v| v.as_str()),
            Some("opencode")
        );
    } else {
        panic!("expected text message");
    }

    let db_id: i64 = session_id.parse().unwrap();
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(handle.runtime_provider, "opencode");
}

#[tokio::test]
async fn test_provider_set_is_locked_once_session_is_active() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();

    {
        let mut sessions = sdk_sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        let (permission_tx, _permission_rx) =
            mpsc::channel::<session_prompt::PermissionResponse>(1);
        handle.state = QueryState::Active {
            query: Arc::new(RwLock::new(Box::new(ClaudeCodeSession::from_query(
                Query::new_test_stub(Some("active-runtime-session".to_string())),
            )))),
            permission_tx,
        };
    }

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "claude_code",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "PROVIDER_LOCKED");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_provider_set_is_locked_once_session_has_history() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();

    sqlx::query(
        "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, 'user', 'hello', 'user_message')",
    )
    .bind(db_id)
    .execute(&app_state.write_pool)
    .await
    .unwrap();

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "opencode",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "PROVIDER_LOCKED");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn provider_set_persists_the_resolved_model_with_the_provider() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;

    // A concrete model is required so the switch is a real change (the
    // default provider is already claude_code, so a no-model pick would be an
    // "unchanged" no-op that writes nothing). The switch resolves `sonnet`.
    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "claude_code",
            "model": "sonnet",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let db_id: i64 = session_id.parse().unwrap();
    let (persisted_provider, persisted_model): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT runtime_provider, model FROM agent_sessions WHERE id = ?")
            .bind(db_id)
            .fetch_one(&app_state.read_pool)
            .await
            .unwrap();

    assert_eq!(persisted_provider.as_deref(), Some("claude_code"));
    assert_eq!(persisted_model.as_deref(), Some("sonnet"));

    // The in-memory handle and the row must agree: a reconnect reads the row.
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(persisted_model, handle.desired_model);
}
