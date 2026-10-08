use super::adapter::RuntimeConfigOverrides;
use super::providers::runtime_adapter;

#[derive(bon::Builder)]
pub(crate) struct RestoreOptions<'a> {
    provider: &'a str,
    runtime_session_id: Option<&'a str>,
    stored_json: Option<&'a str>,
    model: Option<&'a str>,
    thinking_effort: Option<&'a str>,
    fast_mode: bool,
}

/// Restore explicit provenance, or preserve the controls of a legacy resumed
/// session before any caller writes its first override document.
pub(crate) fn restore(options: RestoreOptions<'_>) -> Result<RuntimeConfigOverrides, String> {
    if let Some(json) = options.stored_json {
        return serde_json::from_str(json)
            .map_err(|error| format!("invalid persisted runtime overrides: {error}"));
    }
    let inherits_native = runtime_adapter(options.provider)
        .is_some_and(|adapter| adapter.supports_profile_config_inheritance());
    if inherits_native && options.runtime_session_id.is_some() {
        return Ok(RuntimeConfigOverrides {
            model: options.model.map(ToOwned::to_owned),
            thinking_effort: options.thinking_effort.map(ToOwned::to_owned),
            fast_mode: options.fast_mode.then_some(true),
        });
    }
    Ok(Default::default())
}

#[cfg(test)]
mod tests {
    use super::{restore, RestoreOptions};
    use crate::domain::agents::adapter::RuntimeConfigOverrides;

    #[test]
    fn malformed_persisted_overrides_fail_closed() {
        for provider in ["codex_cli", "claude_code"] {
            let result = restore(
                RestoreOptions::builder()
                    .provider(provider)
                    .runtime_session_id("thread")
                    .stored_json("{")
                    .fast_mode(false)
                    .build(),
            );
            assert!(result
                .unwrap_err()
                .contains("invalid persisted runtime overrides"));
        }
    }

    #[test]
    fn fresh_session_without_provenance_inherits() {
        let restored = restore(
            RestoreOptions::builder()
                .provider("codex_cli")
                .model("legacy")
                .thinking_effort("high")
                .fast_mode(true)
                .build(),
        )
        .unwrap();
        assert_eq!(restored, Default::default());
    }

    #[test]
    fn legacy_resumed_session_preserves_persisted_effective_controls() {
        let restored = restore(
            RestoreOptions::builder()
                .provider("codex_cli")
                .runtime_session_id("thread")
                .model("gpt-5.4")
                .thinking_effort("high")
                .fast_mode(true)
                .build(),
        )
        .unwrap();
        assert_eq!(restored.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(restored.thinking_effort.as_deref(), Some("high"));
        assert_eq!(restored.fast_mode, Some(true));
    }

    #[test]
    fn persisted_provenance_preserves_inheritance_and_explicit_false() {
        let restored = restore(
            RestoreOptions::builder()
                .provider("codex_cli")
                .runtime_session_id("thread")
                .stored_json(r#"{"model":null,"thinking_effort":null,"fast_mode":false}"#)
                .model("stale")
                .thinking_effort("high")
                .fast_mode(true)
                .build(),
        )
        .unwrap();
        assert_eq!(
            restored,
            RuntimeConfigOverrides {
                model: None,
                thinking_effort: None,
                fast_mode: Some(false),
            }
        );
    }
}
