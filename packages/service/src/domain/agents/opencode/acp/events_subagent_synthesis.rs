//! Synthesise the cleaned final-text block for an OpenCode sub-agent
//! (`Task` / `Agent`) tool completion.
//!
//! OpenCode does **not** stream a sub-agent's intermediate events on the
//! parent JSON-RPC stream. Inspecting the live wire log shows the parent
//! session only ever receives:
//!
//! 1. A parent `tool_call` with empty `rawInput` and `title: "task"`.
//! 2. An in-progress `tool_call_update` with full
//!    `rawInput {description, prompt, subagent_type, task_id, command}`.
//! 3. A single completed `tool_call_update` whose payload contains:
//!    - `content[0]` = an `{type:"content", content:{type:"text", text:…}}`
//!      envelope wrapping the body
//!    - `rawOutput.output` = the same body
//!    - `rawOutput.metadata.sessionId` = the (otherwise unused) sub-agent
//!      session id
//!
//! The body itself is wrapped as
//! `task_id: <child-session>\n\n<task_result>\n…body…\n</task_result>`.
//!
//! This module strips the wrapper and builds a synthetic
//! `AssistantMessage` event tagged with `parent_tool_use_id == <task
//! tool_use_id>` so the FE's existing nesting path renders the body as a
//! child Text block inside the Task tool block. Mirrors the Codex pattern
//! in `domain::agents::codex::event_subagents::synthetic_text_event`.

use serde_json::{json, Value};

use crate::domain::agents::adapter::{
    RuntimeAssistantMessage, RuntimeContentBlock, RuntimeEvent, RuntimeEventKind,
    RuntimeEventMetadata,
};

/// Pull the cleaned sub-agent body text out of a Task / Agent
/// `tool_call_update` body. Prefers `rawOutput.output` (most authoritative),
/// falls back to recursively-unwrapped `content[0]`. Strips the OpenCode
/// `task_id: <sid>\n\n` prefix and outer `<task_result>…</task_result>`
/// markers, then trims. Returns `None` if no body text is present or the
/// result is empty.
pub(super) fn extract_subagent_body(body: &Value) -> Option<String> {
    let raw = raw_text_from_body(body)?;
    let cleaned = strip_subagent_wrappers(&raw);
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn raw_text_from_body(body: &Value) -> Option<String> {
    if let Some(output) = body
        .get("rawOutput")
        .and_then(|raw_output| raw_output.get("output"))
        .and_then(Value::as_str)
    {
        return Some(output.to_string());
    }
    let content = body.get("content").and_then(Value::as_array)?;
    for entry in content {
        if let Some(text) = unwrap_text_block(entry) {
            return Some(text.to_string());
        }
    }
    None
}

/// Strip the `task_id: …\n\n` prefix line and the outer
/// `<task_result>` / `</task_result>` markers OpenCode wraps the body in.
/// Defensive: if either marker is absent, leave the rest of the text
/// unchanged so a future wire-shape change still surfaces something readable.
fn strip_subagent_wrappers(raw: &str) -> String {
    let without_prefix = match raw.split_once("\n\n") {
        Some((first_line, rest)) if first_line.trim_start().starts_with("task_id:") => rest,
        _ => raw,
    };
    let trimmed = without_prefix.trim();
    let inside = trimmed
        .strip_prefix("<task_result>")
        .map(str::trim_start)
        .unwrap_or(trimmed);
    let inside = inside
        .strip_suffix("</task_result>")
        .map(str::trim_end)
        .unwrap_or(inside);
    inside.to_string()
}

/// Recursive text unwrap matching OpenCode's `{type:"content", content:{…}}`
/// envelope. Mirrors the helper in `adapter.rs` — kept local to avoid a
/// cross-module `pub(super)` leak for what's a tiny three-line walk.
fn unwrap_text_block(block: &Value) -> Option<&str> {
    let kind = block.get("type").and_then(Value::as_str)?;
    match kind {
        "text" => block.get("text").and_then(Value::as_str),
        "content" => block
            .get("content")
            .and_then(|inner| unwrap_text_block(inner)),
        _ => None,
    }
}

/// Build the synthetic `AssistantMessage` event that nests under the parent
/// Task block via `parent_tool_use_id`. The raw JSON envelope is shaped like
/// a normal assistant text message (matching codex's pattern) so the FE's
/// existing `processAssistantMessage` dispatch routes it correctly.
pub(super) fn synthesize_subagent_text_event(
    metadata: &RuntimeEventMetadata,
    parent_tool_use_id: &str,
    body_text: &str,
) -> RuntimeEvent {
    let session_id = metadata.session_id.clone().unwrap_or_default();
    let raw = json!({
        "type": "assistant",
        "session_id": session_id,
        "parent_tool_use_id": parent_tool_use_id,
        "message": {
            "model": Value::Null,
            "content": [{ "type": "text", "text": body_text }],
        },
    });
    let synthesised_metadata = RuntimeEventMetadata {
        session_id: metadata.session_id.clone(),
        usage: None,
        context_window: None,
        cost_usd: None,
        raw,
    };
    RuntimeEvent::new(
        synthesised_metadata,
        RuntimeEventKind::AssistantMessage {
            message: RuntimeAssistantMessage {
                model: None,
                content: vec![RuntimeContentBlock::Text {
                    text: body_text.to_string(),
                }],
            },
            parent_tool_use_id: Some(parent_tool_use_id.to_string()),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{extract_subagent_body, synthesize_subagent_text_event};
    use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEventMetadata};
    use serde_json::json;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            session_id: Some("ses_parent".to_string()),
            cost_usd: None,
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
    }

    #[test]
    fn extracts_body_from_raw_output_and_strips_full_wrapper() {
        // The shape captured in `/tmp/cadencr-acp-wire.log`:
        //   rawOutput.output = "task_id: ses_…\n\n<task_result>\nbody\n</task_result>"
        let body = json!({
            "rawOutput": {
                "output": "task_id: ses_child\n\n<task_result>\nReal body line 1\nReal body line 2\n</task_result>",
                "metadata": { "sessionId": "ses_child" }
            }
        });
        let extracted = extract_subagent_body(&body).expect("body");
        assert_eq!(extracted, "Real body line 1\nReal body line 2");
    }

    #[test]
    fn falls_back_to_content_when_raw_output_absent() {
        // OpenCode's content envelope: {type:"content", content:{type:"text", text}}
        let body = json!({
            "content": [
                { "type": "content", "content": { "type": "text", "text": "task_id: ses_child\n\n<task_result>\nFallback body\n</task_result>" } }
            ]
        });
        let extracted = extract_subagent_body(&body).expect("body");
        assert_eq!(extracted, "Fallback body");
    }

    #[test]
    fn strips_body_without_task_id_prefix() {
        // Defensive: if a future build drops the `task_id:` preamble, the
        // `<task_result>` strip still fires.
        let body = json!({
            "rawOutput": { "output": "<task_result>\nNo preamble here\n</task_result>" }
        });
        let extracted = extract_subagent_body(&body).expect("body");
        assert_eq!(extracted, "No preamble here");
    }

    #[test]
    fn returns_unwrapped_text_when_markers_missing() {
        // Defensive: an unexpected wire shape with no wrappers should still
        // surface the text rather than dropping it on the floor.
        let body = json!({ "rawOutput": { "output": "Just plain output." } });
        let extracted = extract_subagent_body(&body).expect("body");
        assert_eq!(extracted, "Just plain output.");
    }

    #[test]
    fn returns_none_for_empty_body() {
        let body = json!({
            "rawOutput": { "output": "task_id: ses_child\n\n<task_result>\n   \n</task_result>" }
        });
        assert!(extract_subagent_body(&body).is_none());
    }

    #[test]
    fn returns_none_when_neither_raw_output_nor_text_content_present() {
        let body = json!({ "content": [{ "type": "diff", "path": "/x" }] });
        assert!(extract_subagent_body(&body).is_none());
    }

    #[test]
    fn synthesised_event_carries_text_and_parent_tool_use_id() {
        let event = synthesize_subagent_text_event(&metadata(), "call_parent", "Hello child");
        assert_eq!(event.parent_tool_use_id(), Some("call_parent"));
        let assistant = event.assistant_message().expect("assistant message");
        assert_eq!(assistant.content.len(), 1);
        let RuntimeContentBlock::Text { text } = &assistant.content[0] else {
            panic!("expected text block");
        };
        assert_eq!(text, "Hello child");
        // Raw envelope is shaped like an assistant message so the FE
        // `processAssistantMessage` path picks it up and applies parent
        // nesting from `parent_tool_use_id`.
        let raw = event.raw_json();
        assert_eq!(raw["type"], "assistant");
        assert_eq!(raw["parent_tool_use_id"], "call_parent");
        assert_eq!(raw["message"]["content"][0]["type"], "text");
        assert_eq!(raw["message"]["content"][0]["text"], "Hello child");
    }
}
