use std::path::Path;

use serde_json::{json, Value};

use super::model::{approval_policy, approvals_reviewer, sandbox_policy};
use crate::domain::agents::adapter::{RuntimeAccessMode, RuntimePermissionMode};

pub(super) struct TurnStartOptions<'a> {
    pub(super) cwd: &'a Path,
    pub(super) permission_mode: Option<&'a RuntimePermissionMode>,
    pub(super) access_mode: Option<&'a RuntimeAccessMode>,
    pub(super) model: Option<String>,
    pub(super) effort: Option<String>,
    pub(super) fast_mode: bool,
}

pub(super) fn turn_start_params(
    thread_id: &str,
    input: Vec<Value>,
    options: TurnStartOptions<'_>,
) -> Value {
    let collaboration_mode = collaboration_mode(
        options.permission_mode,
        options.model.as_deref(),
        options.effort.as_deref(),
    );
    let mut params = json!({
        "threadId": thread_id,
        "input": input,
        "cwd": options.cwd.to_string_lossy(),
        "approvalPolicy": approval_policy(options.permission_mode, options.access_mode),
        "approvalsReviewer": approvals_reviewer(options.access_mode),
        "sandboxPolicy": sandbox_policy(options.permission_mode, options.access_mode, options.cwd),
        "summary": "detailed",
    });
    if let Some(model) = options.model {
        params["model"] = Value::String(model);
    }
    if let Some(effort) = options.effort {
        params["effort"] = Value::String(effort);
    }
    params["serviceTier"] = super::fast_service_tier_value(options.fast_mode);
    if let Some(collaboration_mode) = collaboration_mode {
        params["collaborationMode"] = collaboration_mode;
    }
    params
}

pub(super) fn collaboration_mode(
    permission_mode: Option<&RuntimePermissionMode>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Option<Value> {
    let model = model?;
    // Codex persists collaboration mode on the server thread, so send the
    // default mode explicitly when Cadencr leaves plan mode.
    let mode = if matches!(permission_mode, Some(RuntimePermissionMode::Plan)) {
        "plan"
    } else {
        "default"
    };
    Some(json!({
        "mode": mode,
        "settings": {
            "model": model,
            "reasoning_effort": effort,
            // Null means "use Codex's built-in instructions for this
            // collaboration mode". Supplying Cadencr's generic developer
            // guidance here replaces Codex's Plan Mode prompt, leaving the
            // runtime marked as plan while the model is not told how to behave
            // in plan mode. Cadencr guidance is sent separately via thread
            // config / base instructions.
            "developer_instructions": null
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::{turn_start_params, TurnStartOptions};
    use std::path::Path;

    #[test]
    fn turn_start_requests_detailed_reasoning_summaries_and_effort() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "hello" })],
            TurnStartOptions {
                cwd: Path::new("/tmp/app"),
                permission_mode: None,
                access_mode: None,
                model: Some("gpt-5.6-sol".to_string()),
                effort: Some("ultra".to_string()),
                fast_mode: true,
            },
        );

        assert_eq!(params["summary"], "detailed");
        assert_eq!(params["effort"], "ultra");
        assert_eq!(params["model"], "gpt-5.6-sol");
        assert_eq!(params["serviceTier"], "priority");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoning_effort"],
            "ultra"
        );
    }

    #[test]
    fn turn_start_maps_plan_mode_to_codex_collaboration_mode() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "plan" })],
            TurnStartOptions {
                cwd: Path::new("/tmp/app"),
                permission_mode: Some(&crate::domain::agents::adapter::RuntimePermissionMode::Plan),
                access_mode: None,
                model: Some("gpt-5.5".to_string()),
                effort: Some("high".to_string()),
                fast_mode: false,
            },
        );

        assert_eq!(params["collaborationMode"]["mode"], "plan");
        assert_eq!(params["collaborationMode"]["settings"]["model"], "gpt-5.5");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoning_effort"],
            "high"
        );
        assert!(
            params["collaborationMode"]["settings"]["developer_instructions"].is_null(),
            "Codex must use its built-in Plan Mode instructions; a custom \
             collaboration developer prompt replaces them and makes the model \
             unaware that runtime plan mode is active"
        );
    }

    #[test]
    fn turn_start_omits_collaboration_mode_without_model() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "plan" })],
            TurnStartOptions {
                cwd: Path::new("/tmp/app"),
                permission_mode: Some(&crate::domain::agents::adapter::RuntimePermissionMode::Plan),
                access_mode: None,
                model: None,
                effort: Some("high".to_string()),
                fast_mode: false,
            },
        );

        assert!(params.get("collaborationMode").is_none());
    }

    #[test]
    fn turn_start_resets_codex_collaboration_mode_after_plan_mode() {
        let params = turn_start_params(
            "thread",
            vec![serde_json::json!({ "type": "text", "text": "approved" })],
            TurnStartOptions {
                cwd: Path::new("/tmp/app"),
                permission_mode: Some(
                    &crate::domain::agents::adapter::RuntimePermissionMode::AcceptEdits,
                ),
                access_mode: None,
                model: Some("gpt-5.5".to_string()),
                effort: Some("high".to_string()),
                fast_mode: false,
            },
        );

        assert_eq!(params["collaborationMode"]["mode"], "default");
        assert_eq!(params["collaborationMode"]["settings"]["model"], "gpt-5.5");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoning_effort"],
            "high"
        );
    }
}
