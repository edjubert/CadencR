use serde_json::Value;

use codex_app_server_sdk_rs::CONTEXT_USAGE_BASELINE_TOKENS;

use crate::domain::agents::adapter::{
    RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeUsage,
};

pub(super) fn usage_event(params: Value) -> RuntimeEvent {
    let token_usage = params.get("tokenUsage").unwrap_or(&Value::Null);
    let last = token_usage
        .get("last")
        .or_else(|| token_usage.get("total"))
        .unwrap_or(&Value::Null);
    let raw_context_window = token_usage
        .get("modelContextWindow")
        .and_then(Value::as_u64);
    let (usage, context_window) = context_usage(last, raw_context_window);
    let session_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("codex")
        .to_string();

    RuntimeEvent::new(
        RuntimeEventMetadata {
            session_id: Some(session_id.clone()),
            usage: Some(usage),
            context_window,
            cost_usd: None,
            raw: serde_json::json!({ "type": "usage_update", "session_id": session_id }),
        },
        RuntimeEventKind::Other,
    )
}

fn context_usage(last: &Value, context_window: Option<u64>) -> (RuntimeUsage, Option<u64>) {
    let raw_input = last.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
    let raw_output = last
        .get("outputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let Some(context_window) = context_window else {
        return (
            RuntimeUsage {
                input_tokens: raw_input,
                output_tokens: raw_output,
            },
            None,
        );
    };

    if context_window <= CONTEXT_USAGE_BASELINE_TOKENS {
        return (
            RuntimeUsage {
                input_tokens: raw_input,
                output_tokens: raw_output,
            },
            Some(context_window),
        );
    }

    let raw_used = last
        .get("totalTokens")
        .and_then(Value::as_u64)
        .unwrap_or_else(|| raw_input.saturating_add(raw_output));
    (
        RuntimeUsage {
            input_tokens: raw_used.saturating_sub(CONTEXT_USAGE_BASELINE_TOKENS),
            output_tokens: 0,
        },
        Some(context_window - CONTEXT_USAGE_BASELINE_TOKENS),
    )
}

#[cfg(test)]
mod tests {
    use super::usage_event;
    use serde_json::json;

    #[test]
    fn token_usage_matches_codex_context_window_percentage() {
        let event = usage_event(json!({
            "threadId": "thread",
            "tokenUsage": {
                "last": {
                    "inputTokens": 39853,
                    "outputTokens": 280,
                    "cachedInputTokens": 0,
                    "reasoningOutputTokens": 0,
                    "totalTokens": 40133
                },
                "total": {
                    "inputTokens": 3_686_349,
                    "outputTokens": 9_345,
                    "cachedInputTokens": 0,
                    "reasoningOutputTokens": 0,
                    "totalTokens": 3_695_694
                },
                "modelContextWindow": 258400
            }
        }));

        let usage = event.usage().expect("expected usage");
        assert_eq!(usage.input_tokens, 28_133);
        assert_eq!(usage.output_tokens, 0);
        assert_eq!(event.context_window(), Some(246400));
    }

    #[test]
    fn token_usage_falls_back_to_raw_tokens_without_context_window() {
        let event = usage_event(json!({
            "threadId": "thread",
            "tokenUsage": {
                "last": {
                    "inputTokens": 1200,
                    "outputTokens": 30,
                    "cachedInputTokens": 0,
                    "reasoningOutputTokens": 0,
                    "totalTokens": 1230
                },
                "total": {
                    "inputTokens": 1200,
                    "outputTokens": 30,
                    "cachedInputTokens": 0,
                    "reasoningOutputTokens": 0,
                    "totalTokens": 1230
                },
                "modelContextWindow": null
            }
        }));

        let usage = event.usage().expect("expected usage");
        assert_eq!(usage.input_tokens, 1200);
        assert_eq!(usage.output_tokens, 30);
        assert_eq!(event.context_window(), None);
    }
}
