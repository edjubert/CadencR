use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::types::{PermissionDenial, Usage};

use super::events::{AssistantMessageBody, ModelUsageInfo, StreamEventData, SystemMessage};

// ── SdkMessage ───────────────────────────────────────────────────────────────

/// Tagged-union of every message the Claude Code CLI can emit.
///
/// Deserialization uses a custom impl that first tries the fully-typed tagged
/// enum, and on failure falls back to `Unknown(Value)` so the caller is never
/// handed a hard error for forward-compatibility reasons.
///
/// ## Turn management
///
/// | Variant | Cadencr meaning |
/// |---------|-----------------|
/// | `StreamEvent` | Claude's turn — process content deltas in real-time |
/// | `Result` | Turn complete — session agents broadcast `turn_complete`; non-session agents close |
/// | `System(Init)` | Session started — capture `session_id` |
/// | `System(CompactBoundary)` | Context was compacted — set `was_compacted` flag |
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum SdkMessage {
    // === STREAMING (PRIMARY) =================================================
    /// **PRIMARY message type.** Real-time streaming deltas from the Anthropic API.
    ///
    /// Contains `content_block_delta` with `TextDelta`, `ThinkingDelta`, or
    /// `InputJsonDelta`. Also carries `message_start`, `message_stop`, etc.
    #[serde(rename = "stream_event")]
    StreamEvent {
        event: StreamEventData,
        parent_tool_use_id: Option<String>,
        uuid: String,
        session_id: String,
    },

    // === TURN SIGNALS (CRITICAL) =============================================
    /// Signals turn completion.
    ///
    /// `subtype` is one of `"success"`, `"error_max_turns"`,
    /// `"error_during_execution"`, etc.
    #[serde(rename = "result")]
    Result {
        subtype: String,
        uuid: String,
        session_id: String,
        duration_ms: u64,
        duration_api_ms: u64,
        is_error: bool,
        num_turns: u64,
        result: Option<String>,
        errors: Option<Vec<String>>,
        stop_reason: Option<String>,
        total_cost_usd: f64,
        usage: Usage,
        permission_denials: Vec<PermissionDenial>,
        structured_output: Option<Value>,
        /// Per-model usage breakdown. Key is the CLI model identifier
        /// (e.g. `"claude-opus-4-7[1m]"`). Carries the authoritative
        /// `contextWindow`.
        #[serde(default, rename = "modelUsage")]
        model_usage: HashMap<String, ModelUsageInfo>,
        #[serde(flatten)]
        extra: HashMap<String, Value>,
    },

    // === SESSION LIFECYCLE ===================================================
    /// System event (`init` or `compact_boundary`).
    #[serde(rename = "system")]
    System(SystemMessage),

    /// Full assistant message (emitted after stream completes for a turn).
    #[serde(rename = "assistant")]
    Assistant {
        uuid: String,
        session_id: String,
        message: AssistantMessageBody,
        parent_tool_use_id: Option<String>,
        error: Option<String>,
        /// `true` when the CLI synthesized this assistant message to report an
        /// API failure (e.g. a 5xx) rather than a real model response. The
        /// human-readable text lives in `message.content`; `model` is
        /// `"<synthetic>"`.
        #[serde(default, rename = "isApiErrorMessage")]
        is_api_error_message: bool,
        /// HTTP status of the API failure when `is_api_error_message` is set
        /// (e.g. `529`). `None` for non-HTTP errors.
        #[serde(default, rename = "apiErrorStatus")]
        api_error_status: Option<u16>,
    },

    /// User message echo.
    #[serde(rename = "user")]
    User {
        uuid: Option<String>,
        session_id: String,
        message: Value,
        parent_tool_use_id: Option<String>,
        #[serde(default)]
        is_synthetic: Option<bool>,
        tool_use_result: Option<Value>,
        #[serde(default)]
        is_replay: Option<bool>,
    },

    // === OTHER VARIANTS ======================================================
    #[serde(rename = "status")]
    Status {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "hook_started")]
    HookStarted {
        uuid: String,
        session_id: String,
        hook_event: String,
        hook_id: String,
        matcher: Option<String>,
    },

    #[serde(rename = "hook_progress")]
    HookProgress {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "hook_response")]
    HookResponse {
        uuid: String,
        session_id: String,
        hook_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "tool_progress")]
    ToolProgress {
        uuid: String,
        session_id: String,
        tool_use_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "auth_status")]
    AuthStatus {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_notification")]
    TaskNotification {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_started")]
    TaskStarted {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "task_progress")]
    TaskProgress {
        uuid: String,
        session_id: String,
        task_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "files_persisted")]
    FilesPersisted {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "tool_use_summary")]
    ToolUseSummary {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "rate_limit")]
    RateLimit {
        uuid: String,
        session_id: String,
        #[serde(flatten)]
        data: Value,
    },

    #[serde(rename = "prompt_suggestion")]
    PromptSuggestion {
        uuid: String,
        session_id: String,
        suggestion: String,
    },

    /// Catch-all for any message type not yet typed.
    ///
    /// Preserves the raw JSON so callers can handle future CLI additions
    /// without crashing.
    #[serde(skip)]
    Unknown(Value),
}

// ── Helper methods ───────────────────────────────────────────────────────────

impl SdkMessage {
    /// Extract `session_id` from any message variant.
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SdkMessage::StreamEvent { session_id, .. } => Some(session_id),
            SdkMessage::Result { session_id, .. } => Some(session_id),
            SdkMessage::System(s) => Some(s.session_id()),
            SdkMessage::Assistant { session_id, .. } => Some(session_id),
            SdkMessage::User { session_id, .. } => Some(session_id),
            SdkMessage::Status { session_id, .. } => Some(session_id),
            SdkMessage::HookStarted { session_id, .. } => Some(session_id),
            SdkMessage::HookProgress { session_id, .. } => Some(session_id),
            SdkMessage::HookResponse { session_id, .. } => Some(session_id),
            SdkMessage::ToolProgress { session_id, .. } => Some(session_id),
            SdkMessage::AuthStatus { session_id, .. } => Some(session_id),
            SdkMessage::TaskNotification { session_id, .. } => Some(session_id),
            SdkMessage::TaskStarted { session_id, .. } => Some(session_id),
            SdkMessage::TaskProgress { session_id, .. } => Some(session_id),
            SdkMessage::FilesPersisted { session_id, .. } => Some(session_id),
            SdkMessage::ToolUseSummary { session_id, .. } => Some(session_id),
            SdkMessage::RateLimit { session_id, .. } => Some(session_id),
            SdkMessage::PromptSuggestion { session_id, .. } => Some(session_id),
            SdkMessage::Unknown(_) => None,
        }
    }

    /// Returns `true` if this is a `Result` message, signalling turn completion.
    pub fn is_turn_complete(&self) -> bool {
        matches!(self, SdkMessage::Result { .. })
    }

    /// Returns `true` if this is a `StreamEvent` carrying a `content_block_delta`.
    pub fn is_content_delta(&self) -> bool {
        matches!(
            self,
            SdkMessage::StreamEvent {
                event: StreamEventData::ContentBlockDelta { .. },
                ..
            }
        )
    }

    /// Extract `Usage` for context-window tracking.
    ///
    /// Returns usage from `Assistant` messages only — these report per-API-call
    /// token counts that reflect the current context window fill level.
    /// `Result` message usage is **cumulative** across all turns and must NOT be
    /// used for context-window display (it would cause a spike when the agent
    /// finishes). `StreamEvent(MessageDelta)` usage is also excluded.
    pub fn usage(&self) -> Option<&Usage> {
        match self {
            SdkMessage::Assistant { message, .. } => message.usage.as_ref(),
            _ => None,
        }
    }

    /// Extract cumulative usage from the `Result` message (total across all turns).
    ///
    /// Use this for cost tracking / billing, NOT for context-window display.
    pub fn cumulative_usage(&self) -> Option<&Usage> {
        match self {
            SdkMessage::Result { usage, .. } => Some(usage),
            _ => None,
        }
    }

    /// Extract the authoritative context window reported by the CLI on a
    /// `Result` message. When the session involves multiple models in a
    /// single turn, returns the largest declared window (safest upper bound
    /// for display purposes). Returns `None` if no `modelUsage` entry carried
    /// a `contextWindow` field.
    pub fn result_context_window(&self) -> Option<u64> {
        match self {
            SdkMessage::Result { model_usage, .. } => {
                model_usage.values().filter_map(|u| u.context_window).max()
            }
            _ => None,
        }
    }

    /// Returns `true` if this is a `compact_boundary` system message.
    ///
    /// Cadencr sets the `was_compacted` flag on the session when this is received.
    pub fn is_compaction(&self) -> bool {
        matches!(
            self,
            SdkMessage::System(SystemMessage::CompactBoundary { .. })
        )
    }

    /// Extract the cumulative cost (USD) reported on the `Result` message.
    /// This is the running total for the whole CLI process, not a per-turn
    /// delta. `None` for every other message variant.
    pub fn total_cost_usd(&self) -> Option<f64> {
        match self {
            SdkMessage::Result { total_cost_usd, .. } => Some(*total_cost_usd),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{PermissionDenial, Usage};
    use std::collections::HashMap;

    fn result_message(total_cost_usd: f64) -> SdkMessage {
        SdkMessage::Result {
            subtype: "success".into(),
            uuid: "u1".into(),
            session_id: "s1".into(),
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            result: Some("ok".into()),
            errors: None,
            stop_reason: None,
            total_cost_usd,
            usage: Usage {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
            },
            permission_denials: Vec::<PermissionDenial>::new(),
            structured_output: None,
            model_usage: HashMap::new(),
            extra: HashMap::new(),
        }
    }

    #[test]
    fn total_cost_usd_reads_from_result_message() {
        let msg = result_message(0.0421);
        assert_eq!(msg.total_cost_usd(), Some(0.0421));
    }

    #[test]
    fn total_cost_usd_is_none_for_non_result_messages() {
        let msg = SdkMessage::Status {
            uuid: "u1".into(),
            session_id: "s1".into(),
            data: serde_json::json!({}),
        };
        assert_eq!(msg.total_cost_usd(), None);
    }
}
