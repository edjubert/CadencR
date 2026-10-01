//! Provider access-mode wiring: `provider.set` seeds provider defaults and
//! `access_mode.set` applies live policy when supported.

use super::support::*;

struct RecordingAccessModeSession {
    seen: Arc<Mutex<Option<RuntimeAccessMode>>>,
    message_rx: Option<RuntimeMessageRx>,
}
#[async_trait::async_trait]
impl AgentRuntimeSession for RecordingAccessModeSession {
    fn take_message_rx(&mut self) -> RuntimeMessageRx {
        self.message_rx.take().unwrap()
    }

    async fn session_id(&self) -> Option<String> {
        Some("codex-runtime-session".to_string())
    }

    async fn stream_input(&self, _content: Value) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn interrupt(&self) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn close(&mut self) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn set_model(&self, _model: &str) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn set_permission_mode(&self, _mode: RuntimePermissionMode) -> Result<(), RuntimeError> {
        Ok(())
    }
    async fn set_access_mode(&self, mode: RuntimeAccessMode) -> Result<(), RuntimeError> {
        *self.seen.lock().await = Some(mode);
        Ok(())
    }

    fn pid(&self) -> Option<u32> {
        None
    }
}

#[tokio::test]
async fn test_provider_set_to_codex_persists_configured_access_mode() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    // Workspace settings live in the JSON store now (not the SQLite `settings`
    // table), so seed via the repository that production reads through.
    crate::domain::workspace::repository::set_setting(
        &app_state.write_pool,
        "codex_permission_mode",
        "autoReview",
    )
    .await
    .unwrap();

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();

    let envelope = make_envelope(
        "session",
        "provider.set",
        serde_json::json!({
            "session_id": session_id,
            "provider": "codex_cli",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let _provider_ok = rx.recv().await.unwrap();
    let _mode_changed = rx.recv().await.unwrap();

    let row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT runtime_provider, codex_permission_mode, permission_mode FROM agent_sessions WHERE id = ?",
    )
    .bind(db_id)
    .fetch_one(&app_state.read_pool)
    .await
    .unwrap();
    assert_eq!(row.0.as_deref(), Some("codex_cli"));
    assert_eq!(row.1.as_deref(), Some("autoReview"));
    assert_eq!(row.2.as_deref(), Some("default"));

    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(
        handle.desired_access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    assert_eq!(
        handle.config.access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    if let QueryState::Pending(options) = &handle.state {
        assert_eq!(options.access_mode, Some(RuntimeAccessMode::AutoReview));
    } else {
        panic!("expected pending state");
    }
}

#[tokio::test]
async fn codex_permission_mode_set_updates_active_session_and_persists() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_pending_codex(&tx, &mut rx, &sdk_sessions, &app_state).await;
    while rx.try_recv().is_ok() {}
    let db_id: i64 = session_id.parse().unwrap();
    let seen_access_mode = Arc::new(Mutex::new(None));

    {
        let mut sessions = sdk_sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        let (permission_tx, _permission_rx) =
            mpsc::channel::<session_prompt::PermissionResponse>(1);
        let (_message_tx, message_rx) = mpsc::channel(1);
        handle.state = QueryState::Active {
            query: Arc::new(RwLock::new(Box::new(RecordingAccessModeSession {
                seen: Arc::clone(&seen_access_mode),
                message_rx: Some(message_rx),
            }))),
            permission_tx,
        };
        handle.spawned_access_mode = Some(RuntimeAccessMode::FullAccess);
    }

    let envelope = make_envelope(
        "session",
        "codex_permission_mode.set",
        serde_json::json!({
            "session_id": session_id,
            "mode": "autoReview",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "access_mode.changed");
        assert_eq!(
            env.payload.get("mode").and_then(|v| v.as_str()),
            Some("autoReview")
        );
    } else {
        panic!("expected text message");
    }

    let persisted: Option<String> =
        sqlx::query_scalar("SELECT codex_permission_mode FROM agent_sessions WHERE id = ?")
            .bind(db_id)
            .fetch_one(&app_state.read_pool)
            .await
            .unwrap();
    assert_eq!(persisted.as_deref(), Some("autoReview"));

    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(
        handle.desired_access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    assert_eq!(
        handle.config.access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    assert_eq!(
        handle.spawned_access_mode,
        Some(RuntimeAccessMode::FullAccess)
    );
    assert_eq!(
        *seen_access_mode.lock().await,
        Some(RuntimeAccessMode::AutoReview)
    );
}

#[tokio::test]
async fn codex_permission_mode_set_rejects_invalid_mode_with_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let session_id = init_pending_codex(&tx, &mut rx, &sdk_sessions, &app_state).await;
    while rx.try_recv().is_ok() {}

    let envelope = make_envelope(
        "session",
        "codex_permission_mode.set",
        serde_json::json!({
            "session_id": session_id,
            "mode": "turbo",
        }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "INVALID_PAYLOAD");
        assert_eq!(payload.message, "Invalid access mode");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn provider_set_to_cursor_persists_configured_access_mode() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    crate::domain::workspace::repository::set_setting(
        &app_state.write_pool,
        "cursor_access_mode",
        "autoReview",
    )
    .await
    .unwrap();

    let session_id = init_session(&tx, &mut rx, &sdk_sessions, &app_state, 1).await;
    let db_id: i64 = session_id.parse().unwrap();
    dispatch_envelope(
        make_envelope(
            "session",
            "provider.set",
            serde_json::json!({
                "session_id": session_id,
                "provider": "cursor",
            }),
        ),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    let provider_ok = rx.recv().await.unwrap();
    let _mode_changed = rx.recv().await.unwrap();
    let Message::Text(text) = provider_ok else {
        panic!("expected text message");
    };
    let envelope: WsEnvelope = serde_json::from_str(&text).unwrap();
    assert_eq!(envelope.payload["access_mode"], "autoReview");

    let row: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT runtime_provider, codex_permission_mode FROM agent_sessions WHERE id = ?",
    )
    .bind(db_id)
    .fetch_one(&app_state.read_pool)
    .await
    .unwrap();
    assert_eq!(row.0.as_deref(), Some("cursor"));
    assert_eq!(row.1.as_deref(), Some("autoReview"));
    assert_eq!(
        sdk_sessions
            .lock()
            .await
            .get(&db_id)
            .unwrap()
            .desired_access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
}

async fn init_active_cursor_session(
    tx: &mpsc::UnboundedSender<Message>,
    rx: &mut mpsc::UnboundedReceiver<Message>,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
    seen: &Arc<Mutex<Option<RuntimeAccessMode>>>,
    spawned: RuntimeAccessMode,
) -> (i64, String) {
    let session_id = init_session_with_payload(
        tx,
        rx,
        sdk_sessions,
        app_state,
        SessionInitPayload {
            provider: Some("cursor".to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some("/tmp/test".to_string()),
            feature_id: Some(1),
        },
    )
    .await;
    while rx.try_recv().is_ok() {}
    let db_id: i64 = session_id.parse().unwrap();
    {
        let mut sessions = sdk_sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        let (permission_tx, _permission_rx) = mpsc::channel(1);
        let (_message_tx, message_rx) = mpsc::channel(1);
        handle.state = QueryState::Active {
            query: Arc::new(RwLock::new(Box::new(RecordingAccessModeSession {
                seen: Arc::clone(seen),
                message_rx: Some(message_rx),
            }))),
            permission_tx,
        };
        handle.spawned_access_mode = Some(spawned);
    }
    (db_id, session_id)
}

/// Default <-> Auto Review keeps the same sandbox launch flags, so the change
/// is applied to the live host-side preflight and no respawn is queued.
#[tokio::test]
async fn cursor_access_mode_change_applies_in_place_without_respawn() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let seen_access_mode = Arc::new(Mutex::new(None));
    let (db_id, session_id) = init_active_cursor_session(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        &seen_access_mode,
        RuntimeAccessMode::Default,
    )
    .await;

    dispatch_envelope(
        make_envelope(
            "session",
            "access_mode.set",
            serde_json::json!({ "session_id": session_id, "mode": "autoReview" }),
        ),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    let _changed = rx.recv().await.unwrap();
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(
        handle.desired_access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    // Applied live (seen) and marked spawned so the next prompt won't respawn.
    assert_eq!(
        handle.spawned_access_mode,
        Some(RuntimeAccessMode::AutoReview)
    );
    assert_eq!(
        *seen_access_mode.lock().await,
        Some(RuntimeAccessMode::AutoReview)
    );
}

/// Into Full Access flips Cursor's sandbox launch flag, so the host-side
/// preflight adopts it live but `spawned` stays stale to force a respawn that
/// re-launches Cursor with `--sandbox disabled --force`.
#[tokio::test]
async fn cursor_full_access_change_defers_launch_flags_to_respawn() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    let seen_access_mode = Arc::new(Mutex::new(None));
    let (db_id, session_id) = init_active_cursor_session(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        &seen_access_mode,
        RuntimeAccessMode::Default,
    )
    .await;

    dispatch_envelope(
        make_envelope(
            "session",
            "access_mode.set",
            serde_json::json!({ "session_id": session_id, "mode": "fullAccess" }),
        ),
        &tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    let _changed = rx.recv().await.unwrap();
    let sessions = sdk_sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    assert_eq!(
        handle.desired_access_mode,
        Some(RuntimeAccessMode::FullAccess)
    );
    // Launch flags changed: spawned stays stale so the next prompt respawns.
    assert_eq!(handle.spawned_access_mode, Some(RuntimeAccessMode::Default));
    // The host-side preflight still adopts the change immediately.
    assert_eq!(
        *seen_access_mode.lock().await,
        Some(RuntimeAccessMode::FullAccess)
    );
}

#[tokio::test]
async fn cursor_init_uses_cursor_workspace_access_default() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;
    crate::domain::workspace::repository::set_setting(
        &app_state.write_pool,
        "cursor_access_mode",
        "fullAccess",
    )
    .await
    .unwrap();

    let session_id = init_session_with_payload(
        &tx,
        &mut rx,
        &sdk_sessions,
        &app_state,
        SessionInitPayload {
            provider: Some("cursor".to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some("/tmp/test".to_string()),
            feature_id: Some(1),
        },
    )
    .await;

    assert_eq!(
        sdk_sessions
            .lock()
            .await
            .get(&session_id.parse().unwrap())
            .unwrap()
            .desired_access_mode,
        Some(RuntimeAccessMode::FullAccess)
    );
}

#[tokio::test]
async fn provider_switch_to_codex_discards_foreign_profile_and_environment() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let state = make_test_app_state().await;
    let id = init_session(&tx, &mut rx, &sessions, &state, 1).await;
    let db_id = id.parse().unwrap();
    {
        let mut sessions = sessions.lock().await;
        let handle = sessions.get_mut(&db_id).unwrap();
        handle.desired_claude_profile = Some("foreign-claude-profile".into());
        handle.config.claude_profile = Some("foreign-claude-profile".into());
        handle.config.env = Some(HashMap::from([("FOREIGN_TOKEN".into(), "secret".into())]));
        handle.config.env_unset = vec!["FOREIGN_UNSET".into()];
        handle.config.profile_revision = Some("foreign-revision".into());
        handle.config.profile_state_identity = Some("foreign-home".into());
        handle.config.overrides.model = Some("foreign-model".into());
        handle.config.overrides.fast_mode = Some(true);
    }
    dispatch_envelope(
        make_envelope(
            "session",
            "provider.set",
            serde_json::json!({
                "session_id": id, "provider": "codex_cli",
            }),
        ),
        &tx,
        &sessions,
        &state,
    )
    .await;
    let Message::Text(reply) = rx.recv().await.unwrap() else {
        panic!("text expected")
    };
    let reply: WsEnvelope = serde_json::from_str(&reply).unwrap();
    assert_eq!(reply.action, "provider.set.ok", "{:?}", reply.payload);
    let expected_profile =
        crate::domain::agents::codex::profiles::active_id().unwrap_or_else(|| "default".into());
    assert_eq!(reply.payload["profile"], expected_profile);
    assert!(reply.payload["runtime_overrides"]["model"].is_null());
    let sessions = sessions.lock().await;
    let handle = sessions.get(&db_id).unwrap();
    let QueryState::Pending(config) = &handle.state else {
        panic!("pending expected")
    };
    assert_eq!(config.profile.as_deref(), Some(expected_profile.as_str()));
    assert!(!config
        .env
        .as_ref()
        .is_some_and(|env| env.contains_key("FOREIGN_TOKEN")));
    assert!(!config.env_unset.contains(&"FOREIGN_UNSET".to_string()));
    assert_ne!(config.profile_revision.as_deref(), Some("foreign-revision"));
    assert_ne!(
        config.profile_state_identity.as_deref(),
        Some("foreign-home")
    );
    assert_eq!(config.overrides, Default::default());
    let stored: (Option<String>, String) =
        sqlx::query_as("SELECT profile, runtime_overrides FROM agent_sessions WHERE id = ?")
            .bind(db_id)
            .fetch_one(&state.read_pool)
            .await
            .unwrap();
    assert_eq!(stored.0, config.profile);
    assert_eq!(
        serde_json::from_str::<crate::domain::agents::adapter::RuntimeConfigOverrides>(&stored.1)
            .unwrap(),
        config.overrides
    );
}

/// Access-mode unit tests need a pending Codex handle, not a live Codex CLI.
async fn init_pending_codex(
    tx: &WsSender,
    rx: &mut mpsc::UnboundedReceiver<Message>,
    sessions: &SdkSessions,
    state: &AppState,
) -> String {
    let session_id = init_session(tx, rx, sessions, state, 1).await;
    dispatch_envelope(
        make_envelope(
            "session",
            "provider.set",
            serde_json::json!({
                "session_id": session_id, "provider": "codex_cli",
            }),
        ),
        tx,
        sessions,
        state,
    )
    .await;
    let Message::Text(reply) = rx.recv().await.unwrap() else {
        panic!("text expected")
    };
    let reply: WsEnvelope = serde_json::from_str(&reply).unwrap();
    assert_eq!(reply.action, "provider.set.ok", "{:?}", reply.payload);
    session_id
}
