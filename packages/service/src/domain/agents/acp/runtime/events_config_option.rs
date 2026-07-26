//! `config_option_update` notification handler.
//!
//! ACP agents announce authoritative model / thinking-effort changes via
//! a `session/update` whose `sessionUpdate == "config_option_update"`. The
//! payload mirrors the request shape: `configOption: { name, value }`.
//!
//! Two halves:
//! - `map_config_option_update` (sync) is called from the event-mapper to
//!   produce the public `RuntimeEvent` (a benign `Other` so observers see
//!   the raw envelope without leaking provider shape upstream).
//! - `mirror_config_option_update` (async) is called from the event loop
//!   alongside the existing `current_mode_update` mirroring so the agent's
//!   authoritative model/effort lands in the session locks.

use std::sync::Arc;

use serde_json::Value;
use tokio::sync::RwLock;

use crate::domain::agents::adapter::{RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata};

use super::thought_level::is_thought_level_config_name;

/// Build the `RuntimeEvent` for a `config_option_update` notification.
///
/// We intentionally surface a `RuntimeEventKind::Other` rather than inventing
/// a typed variant: today no consumer cares about the structured value, and
/// adding a new public kind would force every other adapter to opt in.
pub fn map_config_option_update(metadata: RuntimeEventMetadata) -> RuntimeEvent {
    RuntimeEvent::new(metadata, RuntimeEventKind::Other)
}

/// Mirror a `config_option_update` body into the session's local state.
///
/// Unrecognised option names are logged at `debug` and ignored. Explicit
/// `null` values clear the corresponding override. Skips the write if the
/// value is already current — this fires on every `session/update` and we
/// don't want to take the writer lock for a no-op.
pub async fn mirror_config_option_update(
    body: &Value,
    current_model: &Arc<RwLock<Option<String>>>,
    current_effort: &Arc<RwLock<Option<String>>>,
) {
    let option = body.get("configOption");
    let name = option
        .and_then(|o| o.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let value = option.and_then(|o| o.get("value"));
    if name == "model" {
        let next = value.and_then(Value::as_str).map(ToOwned::to_owned);
        write_if_changed(current_model, next).await;
        return;
    }
    if is_thought_level_config_name(name) {
        let next = match value {
            Some(Value::Null) | None => None,
            Some(v) => v.as_str().map(ToOwned::to_owned),
        };
        write_if_changed(current_effort, next).await;
        return;
    }
    tracing::debug!(option = name, "ignoring unknown config_option_update");
}

/// Take the writer lock only when the new value differs. Hot-path
/// `session/update` notifications often re-assert the same model/effort
/// per chunk; skipping the write keeps the dispatcher off the writer.
pub(super) async fn write_if_changed(slot: &Arc<RwLock<Option<String>>>, next: Option<String>) {
    if slot.read().await.as_deref() == next.as_deref() {
        return;
    }
    *slot.write().await = next;
}

#[cfg(test)]
mod tests {
    use super::{map_config_option_update, mirror_config_option_update};
    use crate::domain::agents::adapter::RuntimeEventMetadata;
    use serde_json::json;
    use std::sync::Arc;
    use tokio::sync::RwLock;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            session_id: Some("s-1".into()),
            usage: None,
            context_window: None,
            cost_usd: None,
            raw: json!({}),
        }
    }

    #[test]
    fn map_emits_a_benign_other_event() {
        let event = map_config_option_update(metadata());
        // It's not an init / assistant / result event — it's the
        // catch-all so observers can inspect raw if they want.
        assert!(event.init().is_none());
        assert!(event.assistant_message().is_none());
        assert!(!event.is_result());
    }

    #[tokio::test]
    async fn model_update_writes_current_model() {
        let model = Arc::new(RwLock::new(Some("old".to_string())));
        let effort = Arc::new(RwLock::new(None));
        let body = json!({ "configOption": { "name": "model", "value": "anthropic/claude-4.7" } });
        mirror_config_option_update(&body, &model, &effort).await;
        assert_eq!(model.read().await.as_deref(), Some("anthropic/claude-4.7"));
        assert!(effort.read().await.is_none());
    }

    #[tokio::test]
    async fn thinking_effort_update_writes_effort() {
        let model = Arc::new(RwLock::new(None));
        let effort = Arc::new(RwLock::new(None));
        let body = json!({ "configOption": { "name": "thinkingEffort", "value": "high" } });
        mirror_config_option_update(&body, &model, &effort).await;
        assert_eq!(effort.read().await.as_deref(), Some("high"));
    }

    #[tokio::test]
    async fn null_thinking_effort_clears_local_value() {
        let model = Arc::new(RwLock::new(None));
        let effort = Arc::new(RwLock::new(Some("high".to_string())));
        let body = json!({ "configOption": { "name": "thinkingEffort", "value": null } });
        mirror_config_option_update(&body, &model, &effort).await;
        assert!(effort.read().await.is_none());
    }

    #[tokio::test]
    async fn unknown_option_is_ignored() {
        let model = Arc::new(RwLock::new(Some("keep".to_string())));
        let effort = Arc::new(RwLock::new(Some("medium".to_string())));
        let body = json!({ "configOption": { "name": "exotic", "value": 42 } });
        mirror_config_option_update(&body, &model, &effort).await;
        assert_eq!(model.read().await.as_deref(), Some("keep"));
        assert_eq!(effort.read().await.as_deref(), Some("medium"));
    }
}
