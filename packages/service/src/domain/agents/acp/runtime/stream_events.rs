//! Provider-neutral streaming `RuntimeEvent` constructors for ACP-derived streams.
//!
//! These helpers build Cadencr runtime stream envelopes (`message_start`,
//! `content_block_start`, `content_block_delta`, and `content_block_stop`)
//! without depending on any concrete ACP provider.

use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata,
    RuntimeStreamEvent, RuntimeUsage,
};

fn metadata(session_id: String, usage: Option<RuntimeUsage>, raw: Value) -> RuntimeEventMetadata {
    RuntimeEventMetadata {
        session_id: Some(session_id),
        usage,
        cost_usd: None,
        raw,
        ..RuntimeEventMetadata::default()
    }
}

pub fn message_start_event(
    session_id: &str,
    model: Option<String>,
    usage: Option<RuntimeUsage>,
    parent_tool_use_id: Option<&str>,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": parent_json_value(parent_tool_use_id),
        "event": {
            "type": "message_start",
            "message": { "model": model.clone() },
        }
    });
    RuntimeEvent::new(
        metadata(session_id.to_string(), usage, raw),
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::MessageStart {
                model,
                input_tokens: None,
            },
            parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
        },
    )
}

pub fn stream_start_event(
    session_id: &str,
    index: u64,
    block: RuntimeContentBlock,
    parent_tool_use_id: Option<&str>,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": parent_json_value(parent_tool_use_id),
        "event": {
            "type": "content_block_start",
            "index": index,
            "content_block": runtime_content_block_to_json(&block),
        }
    });
    RuntimeEvent::new(
        metadata(session_id.to_string(), None, raw),
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStart { index, block },
            parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
        },
    )
}

pub fn stream_delta_event(
    session_id: &str,
    index: u64,
    delta: RuntimeContentDelta,
    parent_tool_use_id: Option<&str>,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": parent_json_value(parent_tool_use_id),
        "event": {
            "type": "content_block_delta",
            "index": index,
            "delta": runtime_delta_to_json(&delta),
        }
    });
    RuntimeEvent::new(
        metadata(session_id.to_string(), None, raw),
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockDelta { index, delta },
            parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
        },
    )
}

pub fn stream_stop_event(
    session_id: &str,
    index: u64,
    parent_tool_use_id: Option<&str>,
) -> RuntimeEvent {
    let raw = serde_json::json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": parent_json_value(parent_tool_use_id),
        "event": {
            "type": "content_block_stop",
            "index": index,
        }
    });
    RuntimeEvent::new(
        metadata(session_id.to_string(), None, raw),
        RuntimeEventKind::StreamEvent {
            event: RuntimeStreamEvent::ContentBlockStop { index },
            parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
        },
    )
}

fn parent_json_value(parent_tool_use_id: Option<&str>) -> Value {
    parent_tool_use_id.map_or(Value::Null, |value| Value::String(value.to_string()))
}

fn runtime_content_block_to_json(block: &RuntimeContentBlock) -> Value {
    match block {
        RuntimeContentBlock::Text { text } => serde_json::json!({ "type": "text", "text": text }),
        RuntimeContentBlock::Thinking { thinking } => {
            serde_json::json!({ "type": "thinking", "thinking": thinking })
        }
        RuntimeContentBlock::ToolUse { id, name, input } => {
            serde_json::json!({ "type": "tool_use", "id": id, "name": name, "input": input })
        }
        RuntimeContentBlock::Other => serde_json::json!({ "type": "unknown" }),
    }
}

fn runtime_delta_to_json(delta: &RuntimeContentDelta) -> Value {
    match delta {
        RuntimeContentDelta::Text { text } => {
            serde_json::json!({ "type": "text_delta", "text": text })
        }
        RuntimeContentDelta::Thinking { thinking } => {
            serde_json::json!({ "type": "thinking_delta", "thinking": thinking })
        }
        RuntimeContentDelta::InputJson { partial_json } => {
            serde_json::json!({ "type": "input_json_delta", "partial_json": partial_json })
        }
    }
}
