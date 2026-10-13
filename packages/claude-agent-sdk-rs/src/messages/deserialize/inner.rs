use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::types::{PermissionDenial, Usage};

use crate::messages::{AssistantMessageBody, ModelUsageInfo, StreamEventData, SystemMessage};

/// Internal mirror of `SdkMessage` used by the derived deserializer.
/// We keep this private and convert into the public enum, adding the
/// `Unknown` fallback path.
#[derive(Deserialize)]
#[serde(tag = "type")]
pub(super) enum SdkMessageInner {
    #[serde(rename = "stream_event")]
    StreamEvent {
        event: StreamEventData,
        parent_tool_use_id: Option<String>,
        uuid: String,
        session_id: String,
    },
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
        #[serde(default)]
        permission_denials: Vec<PermissionDenial>,
        structured_output: Option<Value>,
        #[serde(default, rename = "modelUsage")]
        model_usage: HashMap<String, ModelUsageInfo>,
        #[serde(flatten)]
        extra: HashMap<String, Value>,
    },
    #[serde(rename = "system")]
    System(SystemMessage),
    #[serde(rename = "assistant")]
    Assistant {
        uuid: String,
        session_id: String,
        message: AssistantMessageBody,
        parent_tool_use_id: Option<String>,
        error: Option<String>,
        #[serde(default, rename = "isApiErrorMessage")]
        is_api_error_message: bool,
        #[serde(default, rename = "apiErrorStatus")]
        api_error_status: Option<u16>,
    },
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
    #[serde(rename = "rate_limit", alias = "rate_limit_event")]
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
    #[serde(rename = "command_lifecycle")]
    CommandLifecycle {
        uuid: String,
        session_id: String,
        command_uuid: String,
        state: String,
    },
}
