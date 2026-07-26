//! Question-tool mapping helpers for ACP tool calls.
//!
//! OpenCode-specific UX: kept in `opencode/acp/` because the question
//! payload shape and the synthetic `acp_permission_request` envelope
//! we emit on the runtime channel are OpenCode quirks. The shared ACP
//! runtime delegates here through `OpenCodeAcpAdapter`'s tool-call
//! overrides.

use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
use crate::domain::agents::adapter::{RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata};

pub(super) fn question_start_event(
    tool_call_id: &str,
    tool_input: Value,
    metadata: RuntimeEventMetadata,
    parent: Option<String>,
    indexer: &mut EventIndexer,
) -> Option<RuntimeEvent> {
    if should_emit_question_prompt(tool_call_id, &tool_input, indexer) {
        return Some(question_permission_event(
            tool_call_id,
            tool_input,
            metadata,
            parent,
        ));
    }
    None
}

pub(super) fn question_update_event(
    tool_call_id: &str,
    body: &Value,
    status: &str,
    metadata: RuntimeEventMetadata,
    parent: Option<String>,
    indexer: &mut EventIndexer,
) -> Option<RuntimeEvent> {
    if matches!(status, "completed" | "failed") {
        return None;
    }
    let raw_input = body
        .get("toolInput")
        .or_else(|| body.get("rawInput"))
        .cloned()
        .unwrap_or(Value::Null);
    question_start_event(tool_call_id, raw_input, metadata, parent, indexer)
}

fn should_emit_question_prompt(
    tool_call_id: &str,
    tool_input: &Value,
    indexer: &mut EventIndexer,
) -> bool {
    input_has_questions(tool_input) && indexer.mark_question_prompt_emitted(tool_call_id)
}

/// True when an AskUserQuestion `toolInput` actually carries a question
/// the FE drawer can render — either the canonical OpenCode shape
/// `{ questions: [{ question, options? }] }` or the legacy
/// `{ question, options? }` flat shape we also accept.
fn input_has_questions(input: &Value) -> bool {
    if let Some(arr) = input.get("questions").and_then(Value::as_array) {
        return !arr.is_empty();
    }
    input
        .get("question")
        .and_then(Value::as_str)
        .map(|s| !s.is_empty())
        .unwrap_or(false)
}

fn question_permission_event(
    tool_call_id: &str,
    tool_input: Value,
    metadata: RuntimeEventMetadata,
    parent: Option<String>,
) -> RuntimeEvent {
    let mut event = RuntimeEvent::new(
        RuntimeEventMetadata {
            cost_usd: None,
            raw: json!({
                "type": "acp_permission_request",
                "transport": "acp",
                "request_id": tool_call_id,
                "call_id": tool_call_id,
                "tool_name": "AskUserQuestion",
                "tool_input": tool_input,
                "description": "OpenCode question",
            }),
            ..metadata
        },
        RuntimeEventKind::Other,
    );
    event.set_parent_tool_use_id(parent);
    event
}

#[cfg(test)]
mod tests {
    use super::{question_start_event, question_update_event};
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::adapter::RuntimeEventMetadata;
    use serde_json::json;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            cost_usd: None,
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
    }

    #[test]
    fn question_start_with_empty_input_is_swallowed() {
        let mut idx = EventIndexer::default();
        let result = question_start_event("q-1", json!({}), metadata(), None, &mut idx);

        assert!(result.is_none());
    }

    #[test]
    fn question_update_emits_permission_event_with_real_payload() {
        let mut idx = EventIndexer::default();
        let update = question_update_event(
            "q-2",
            &json!({
                "status": "in_progress",
                "rawInput": {
                    "questions": [{
                        "question": "Pick a primary color",
                        "options": [
                            { "label": "Red" },
                            { "label": "Green" },
                            { "label": "Blue" }
                        ]
                    }]
                }
            }),
            "in_progress",
            metadata(),
            None,
            &mut idx,
        )
        .expect("permission event");

        let raw = update.raw_json();
        assert_eq!(raw["type"], "acp_permission_request");
        assert_eq!(raw["tool_name"], "AskUserQuestion");
        assert_eq!(raw["request_id"], "q-2");
        assert_eq!(
            raw["tool_input"]["questions"][0]["question"],
            "Pick a primary color"
        );
    }

    #[test]
    fn question_completed_update_does_not_reopen_question() {
        let mut idx = EventIndexer::default();
        let update = question_update_event(
            "q-3",
            &json!({
                "status": "completed",
                "rawInput": {
                    "questions": [{
                        "question": "Pick a color",
                        "options": [{ "label": "Blue" }, { "label": "Red" }]
                    }]
                }
            }),
            "completed",
            metadata(),
            None,
            &mut idx,
        );

        assert!(update.is_none());
    }

    #[test]
    fn question_repeated_in_progress_update_emits_once() {
        let mut idx = EventIndexer::default();
        let payload = json!({
            "status": "in_progress",
            "rawInput": {
                "questions": [{
                    "question": "Pick a color",
                    "options": [{ "label": "Blue" }, { "label": "Red" }]
                }]
            }
        });

        let first =
            question_update_event("q-4", &payload, "in_progress", metadata(), None, &mut idx);
        let second =
            question_update_event("q-4", &payload, "in_progress", metadata(), None, &mut idx);

        assert!(first.is_some());
        assert!(second.is_none());
    }
}
