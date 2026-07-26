//! Regression coverage for interactive stop/resume semantics. A user stop is
//! control flow, not a child failure, even when the provider represents it as
//! an error result or closes the runtime stream.

use super::support::*;

use crate::domain::agents::adapter::{RuntimeEventMetadata, RuntimeResultError};
use crate::domain::agents::runtime::DEFAULT_PROVIDER;

async fn setup_interrupted_session(
    app_state: &AppState,
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) {
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (?, 1, 'running')")
        .bind(db_session_id)
        .execute(&app_state.write_pool)
        .await
        .unwrap();
    let runtime = make_active_handle(1, Some("cli".into()));
    let QueryState::Active { query, .. } = &runtime.state else {
        unreachable!()
    };
    let query = query.clone();
    sdk_sessions.lock().await.insert(db_session_id, runtime);
    app_state
        .active_turns
        .begin_turn(db_session_id, sdk_sessions, 1_000)
        .await;
    app_state
        .active_turns
        .request_interruption(db_session_id, &query)
        .await
        .expect("active turn accepts interruption");
    seed_armed_reply_wait(app_state, db_session_id).await;
}

async fn seed_armed_reply_wait(app_state: &AppState, responder_session_id: i64) {
    sqlx::query(
        "CREATE TABLE agent_session_reply_waits (
            id INTEGER PRIMARY KEY,
            requester_session_id INTEGER NOT NULL,
            responder_session_id INTEGER NOT NULL,
            request_message_id INTEGER,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            armed_at TEXT,
            delivered_at TEXT,
            error TEXT,
            delivery_claim_token TEXT,
            delivery_started_at TEXT,
            delivery_message_uuid TEXT
        )",
    )
    .execute(&app_state.write_pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO agent_session_reply_waits
         (id, requester_session_id, responder_session_id, request_message_id, kind, status)
         VALUES (1, 9999, ?, 1, 'spawn', 'armed')",
    )
    .bind(responder_session_id)
    .execute(&app_state.write_pool)
    .await
    .unwrap();
}

fn message_start() -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some("cli".into()),
            raw: serde_json::json!({ "type": "stream_event" }),
            ..RuntimeEventMetadata::default()
        },
        RuntimeEventKind::StreamEvent {
            event: crate::domain::agents::adapter::RuntimeStreamEvent::MessageStart {
                model: Some("claude-sonnet".into()),
                input_tokens: None,
            },
            parent_tool_use_id: None,
        },
    )
}

fn interrupted_error_result() -> RuntimeEvent {
    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some("cli".into()),
            raw: serde_json::json!({
                "type": "result",
                "subtype": "error_during_execution",
                "is_error": true
            }),
            ..RuntimeEventMetadata::default()
        },
        RuntimeEventKind::Result,
    )
    .with_result_error(Some(RuntimeResultError {
        code: "ERROR_DURING_EXECUTION".into(),
        message: "Claude Code ended the interrupted turn with an error".into(),
    }))
}

async fn drain_actions(
    ws_rx: &mut mpsc::UnboundedReceiver<Message>,
) -> Vec<(String, serde_json::Value)> {
    let mut actions = Vec::new();
    while let Ok(Some(Message::Text(text))) =
        tokio::time::timeout(std::time::Duration::from_millis(100), ws_rx.recv()).await
    {
        let envelope: WsEnvelope = serde_json::from_str(&text).unwrap();
        actions.push((envelope.action, envelope.payload));
    }
    actions
}

async fn assert_benign_stop_state(app_state: &AppState, session_id: i64) {
    let state: (String, i64, String) = sqlx::query_as(
        "SELECT s.status,
                (SELECT COUNT(*) FROM agent_messages
                 WHERE session_id = s.id AND message_type = 'error'),
                (SELECT status FROM agent_session_reply_waits WHERE id = 1)
         FROM agent_sessions s WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_one(&app_state.write_pool)
    .await
    .unwrap();
    assert_eq!(state, ("completed".into(), 0, "armed".into()));
}

#[tokio::test]
async fn interrupt_control_keeps_completion_follow_armed() {
    let app_state = make_test_app_state().await;
    let sdk_sessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let session_id = 609;
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (?, 1, 'running')")
        .bind(session_id)
        .execute(&app_state.write_pool)
        .await
        .unwrap();
    let runtime = make_in_place_effort_handle(1);
    let QueryState::Active { query, .. } = &runtime.state else {
        unreachable!()
    };
    let query = query.clone();
    sdk_sessions.lock().await.insert(session_id, runtime);
    app_state
        .active_turns
        .begin_turn(session_id, &sdk_sessions, 1_000)
        .await;
    seed_armed_reply_wait(&app_state, session_id).await;

    dispatch_envelope(
        make_envelope(
            "session",
            "interrupt",
            serde_json::json!({ "session_id": session_id.to_string() }),
        ),
        &ws_tx,
        &sdk_sessions,
        &app_state,
    )
    .await;

    let wait_status: String =
        sqlx::query_scalar("SELECT status FROM agent_session_reply_waits WHERE id = 1")
            .fetch_one(&app_state.write_pool)
            .await
            .unwrap();
    assert_eq!(wait_status, "armed");
    assert!(app_state
        .active_turns
        .take_interruption(session_id, &Arc::downgrade(&query))
        .await
        .is_some());
    assert!(
        ws_rx.try_recv().is_err(),
        "successful stop emits no error reply"
    );
}

#[tokio::test]
async fn intentional_stop_with_stream_close_is_benign_and_keeps_parent_wait_armed() {
    let app_state = make_test_app_state().await;
    let sdk_sessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let session_id = 610;
    setup_interrupted_session(&app_state, &sdk_sessions, session_id).await;

    let (msg_tx, msg_rx) = mpsc::channel(1);
    msg_tx.send(Ok(message_start())).await.unwrap();
    drop(msg_tx);
    spawn_test_stream_reader(
        &app_state,
        session_id,
        1,
        msg_rx,
        ws_tx,
        sdk_sessions,
        DEFAULT_PROVIDER,
    );

    let actions = drain_actions(&mut ws_rx).await;
    assert!(actions.iter().all(|(action, _)| action != "error"));
    assert!(actions
        .iter()
        .any(|(action, payload)| { action == "ended" && payload["reason"] == "turn_interrupted" }));
    assert_benign_stop_state(&app_state, session_id).await;
}

#[tokio::test]
async fn intentional_stop_suppresses_provider_error_result_and_parent_failure() {
    let app_state = make_test_app_state().await;
    let sdk_sessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let session_id = 611;
    setup_interrupted_session(&app_state, &sdk_sessions, session_id).await;

    let (msg_tx, msg_rx) = mpsc::channel(1);
    msg_tx.send(Ok(interrupted_error_result())).await.unwrap();
    drop(msg_tx);
    spawn_test_stream_reader(
        &app_state,
        session_id,
        1,
        msg_rx,
        ws_tx,
        sdk_sessions,
        DEFAULT_PROVIDER,
    );

    let actions = drain_actions(&mut ws_rx).await;
    assert!(actions.iter().all(|(action, _)| action != "error"));
    assert!(actions
        .iter()
        .any(|(action, payload)| { action == "ended" && payload["reason"] == "turn_interrupted" }));
    assert_benign_stop_state(&app_state, session_id).await;
}

#[tokio::test]
async fn ended_reader_cannot_replace_a_newly_resumed_runtime() {
    let app_state = make_test_app_state().await;
    let sdk_sessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let session_id = 612;
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (?, 1, 'completed')")
        .bind(session_id)
        .execute(&app_state.write_pool)
        .await
        .unwrap();
    sdk_sessions
        .lock()
        .await
        .insert(session_id, make_active_handle(1, Some("old".into())));

    let (msg_tx, msg_rx) = mpsc::channel(1);
    spawn_test_stream_reader_with_cleanup(
        &app_state,
        session_id,
        1,
        msg_rx,
        ws_tx,
        sdk_sessions.clone(),
        DEFAULT_PROVIDER,
        true,
    );
    let replacement = make_active_handle(1, Some("new".into()));
    let QueryState::Active {
        query: replacement_query,
        ..
    } = &replacement.state
    else {
        unreachable!()
    };
    let replacement_query = replacement_query.clone();
    sdk_sessions.lock().await.insert(session_id, replacement);
    drop(msg_tx);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let sessions = sdk_sessions.lock().await;
    let QueryState::Active { query, .. } = &sessions.get(&session_id).unwrap().state else {
        panic!("replacement runtime must remain active");
    };
    assert!(Arc::ptr_eq(query, &replacement_query));
    drop(sessions);
    assert!(drain_actions(&mut ws_rx).await.is_empty());
}

#[tokio::test]
async fn replacement_reader_cannot_consume_an_old_interruption_or_receive_its_end() {
    let app_state = make_test_app_state().await;
    let sdk_sessions = Arc::new(Mutex::new(HashMap::new()));
    let (ws_tx, mut ws_rx) = mpsc::unbounded_channel();
    let session_id = 613;
    sqlx::query("INSERT INTO agent_sessions (id, feature_id, status) VALUES (?, 1, 'running')")
        .bind(session_id)
        .execute(&app_state.write_pool)
        .await
        .unwrap();
    let old = make_active_handle(1, Some("old".into()));
    let QueryState::Active {
        query: old_query, ..
    } = &old.state
    else {
        unreachable!()
    };
    let old_query = old_query.clone();
    sdk_sessions.lock().await.insert(session_id, old);
    app_state
        .active_turns
        .begin_turn(session_id, &sdk_sessions, 1_000)
        .await;
    app_state
        .active_turns
        .request_interruption(session_id, &old_query)
        .await
        .unwrap();
    seed_armed_reply_wait(&app_state, session_id).await;

    sdk_sessions
        .lock()
        .await
        .insert(session_id, make_active_handle(1, Some("new".into())));
    app_state
        .active_turns
        .begin_turn(session_id, &sdk_sessions, 2_000)
        .await;
    let (msg_tx, msg_rx) = mpsc::channel(1);
    msg_tx.send(Ok(interrupted_error_result())).await.unwrap();
    drop(msg_tx);
    spawn_test_stream_reader_for_runtime(
        &app_state,
        session_id,
        1,
        msg_rx,
        Some(Arc::downgrade(&old_query)),
        ws_tx,
        sdk_sessions,
        DEFAULT_PROVIDER,
        false,
    );

    assert!(drain_actions(&mut ws_rx).await.is_empty());
    let state: (String, String) = sqlx::query_as(
        "SELECT s.status, w.status FROM agent_sessions s
         JOIN agent_session_reply_waits w ON w.responder_session_id = s.id
         WHERE s.id = ?",
    )
    .bind(session_id)
    .fetch_one(&app_state.write_pool)
    .await
    .unwrap();
    assert_eq!(state, ("running".into(), "armed".into()));
}
