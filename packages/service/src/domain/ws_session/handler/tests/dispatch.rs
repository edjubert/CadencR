//! Top-level dispatch routing: unknown domain/action handling and the
//! `parse_session_id` helper.

use super::support::*;

#[tokio::test]
async fn test_unknown_domain_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

    let envelope = make_envelope("unknown_domain", "init", serde_json::json!({}));
    let app_state = make_test_app_state().await;
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "UNKNOWN_DOMAIN");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn test_unknown_action_returns_error() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));

    let envelope = make_envelope("session", "nonexistent_action", serde_json::json!({}));
    let app_state = make_test_app_state().await;
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    let msg = rx.recv().await.unwrap();
    if let Message::Text(text) = msg {
        let env: WsEnvelope = serde_json::from_str(&text).unwrap();
        assert_eq!(env.action, "error");
        let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
        assert_eq!(payload.code, "UNKNOWN_ACTION");
    } else {
        panic!("expected text message");
    }
}

#[tokio::test]
async fn neovim_key_input_action_dispatches_to_send_keys() {
    if !crate::domain::neovim::service::tests::nvim_available() {
        eprintln!("SKIP: nvim binary not found");
        return;
    }

    let (tx, mut rx) = mpsc::unbounded_channel();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = make_test_app_state().await;

    let feature_id = 700;
    app_state
        .neovim_manager
        .start(feature_id, app_state.ws_feature_senders.clone())
        .await
        .expect("neovim start should succeed");
    app_state
        .neovim_manager
        .push_buffer(feature_id, "src/main.rs", "line one\nline two\n")
        .await
        .expect("push_buffer should succeed");

    let envelope = make_envelope(
        "neovim",
        "key_input",
        serde_json::json!({ "feature_id": feature_id, "file_path": "src/main.rs", "keys": "j" }),
    );
    dispatch_envelope(envelope, &tx, &sdk_sessions, &app_state).await;

    // No error envelope should have been sent back — send_keys succeeded.
    assert!(
        rx.try_recv().is_err(),
        "expected no error envelope for a successful key_input dispatch"
    );
}

#[tokio::test]
async fn test_parse_session_id() {
    assert_eq!(parse_session_id("42"), Some(42));
    assert_eq!(parse_session_id("abc"), None);
    assert_eq!(parse_session_id(""), None);
}
