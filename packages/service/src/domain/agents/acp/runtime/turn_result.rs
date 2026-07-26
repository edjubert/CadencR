//! Per-turn `Result` envelope emission and `session/prompt` usage parsing.
//! Sibling of [`super::turn_lifecycle`]; split out so neither file exceeds
//! the 400-line ceiling once W4's tests land.

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeUsage,
};

/// Forward a `RuntimeEventKind::Result` envelope to the message channel
/// when the agent reports a `stopReason`.
pub async fn emit_turn_result(
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    session_id: Option<String>,
    context_window: Option<u64>,
    usage: Option<RuntimeUsage>,
    stop_reason: &str,
    response: &Value,
) {
    let raw = json!({
        "type": "result",
        "session_id": session_id.clone(),
        "stop_reason": stop_reason,
        "transport": "acp",
        "usage": response.get("usage").cloned().unwrap_or(Value::Null),
    });
    let metadata = RuntimeEventMetadata {
        session_id,
        usage,
        context_window,
        cost_usd: None,
        raw,
    };
    let event = RuntimeEvent::new(metadata, RuntimeEventKind::Result);
    if let Err(error) = tx.send(Ok(event)).await {
        tracing::debug!(%error, "failed to forward ACP turn result; channel closed");
    }
}

#[cfg(test)]
mod tests {
    use super::emit_turn_result;
    use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};
    use serde_json::json;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn emit_turn_result_sends_a_result_event() {
        let (tx, mut rx) = mpsc::channel(4);
        emit_turn_result(
            &tx,
            Some("s-1".into()),
            Some(123_456),
            None,
            "end_turn",
            &json!({}),
        )
        .await;
        let event = rx.recv().await.unwrap().unwrap();
        assert!(event.is_result());
        assert_eq!(event.raw_json()["stop_reason"], "end_turn");
        assert_eq!(event.raw_json()["transport"], "acp");
    }

    #[tokio::test]
    async fn emit_turn_result_silently_drops_when_channel_closed() {
        let (tx, rx) = mpsc::channel::<Result<RuntimeEvent, RuntimeError>>(1);
        drop(rx);
        emit_turn_result(&tx, None, None, None, "cancelled", &json!({})).await;
    }

    #[tokio::test]
    async fn emit_turn_result_does_not_treat_prompt_response_usage_as_context_usage() {
        let (tx, mut rx) = mpsc::channel(4);
        emit_turn_result(
            &tx,
            Some("s-1".into()),
            Some(200_000),
            None,
            "end_turn",
            &json!({
                "usage": {
                    "totalTokens": 10_669,
                    "inputTokens": 10_653,
                    "outputTokens": 3,
                    "thoughtTokens": 13,
                }
            }),
        )
        .await;
        let event = rx.recv().await.unwrap().unwrap();
        assert!(
            event.usage().is_none(),
            "session/prompt usage is per-turn accounting, not a context-budget snapshot",
        );
        assert_eq!(event.context_window(), Some(200_000));
    }

    #[tokio::test]
    async fn emit_turn_result_can_attach_provider_usage_fallback() {
        let (tx, mut rx) = mpsc::channel(4);
        emit_turn_result(
            &tx,
            Some("s-1".into()),
            Some(200_000),
            Some(crate::domain::agents::adapter::RuntimeUsage {
                input_tokens: 12_345,
                output_tokens: 0,
            }),
            "end_turn",
            &json!({}),
        )
        .await;
        let event = rx.recv().await.unwrap().unwrap();
        let usage = event.usage().expect("provider fallback usage is attached");
        assert_eq!(usage.input_tokens, 12_345);
        assert_eq!(usage.output_tokens, 0);
    }
}
