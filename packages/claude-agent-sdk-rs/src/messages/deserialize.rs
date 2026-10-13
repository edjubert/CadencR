use serde::{Deserialize, Deserializer};
use serde_json::Value;
use tracing::warn;

use super::sdk_message::SdkMessage;

mod convert;
mod inner;

use inner::SdkMessageInner;

// ── Custom Deserialize for SdkMessage ────────────────────────────────────────

impl SdkMessage {
    /// Convert a raw CLI wire message into an `SdkMessage`, infallibly.
    ///
    /// Never silently drops: a message that fails to match any known schema
    /// becomes `Unknown(raw)` (so the stream survives) with a log of exactly
    /// what and why, so a CLI wire-format drift is diagnosable instead of
    /// presenting as an agent that "just stopped".
    pub fn from_raw(raw: Value) -> Self {
        match SdkMessageInner::deserialize(&raw) {
            Ok(inner) => SdkMessage::from(inner),
            Err(error) => {
                let message_type = raw
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<missing>");
                let subtype = raw.get("subtype").and_then(|v| v.as_str());
                warn!(
                    message_type,
                    ?subtype,
                    %error,
                    "claude SDK: message did not match any known schema; forwarding as Unknown (it will not render in the conversation)"
                );
                SdkMessage::Unknown(raw)
            }
        }
    }
}

impl<'de> Deserialize<'de> for SdkMessage {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        // Buffer the raw value so the fallback can keep it on failure.
        let raw = Value::deserialize(deserializer)?;
        Ok(SdkMessage::from_raw(raw))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deserializes_api_error_markers_on_assistant() {
        let msg: SdkMessage = serde_json::from_value(json!({
            "type": "assistant",
            "uuid": "u",
            "session_id": "s",
            "message": { "id": "syn", "model": "<synthetic>", "content": [] },
            "error": "server_error",
            "isApiErrorMessage": true,
            "apiErrorStatus": 529
        }))
        .expect("valid assistant");

        match msg {
            SdkMessage::Assistant {
                is_api_error_message,
                api_error_status,
                error,
                ..
            } => {
                assert!(is_api_error_message);
                assert_eq!(api_error_status, Some(529));
                assert_eq!(error.as_deref(), Some("server_error"));
            }
            other => panic!("expected assistant, got {other:?}"),
        }
    }

    #[test]
    fn defaults_api_error_markers_when_absent() {
        let msg: SdkMessage = serde_json::from_value(json!({
            "type": "assistant",
            "uuid": "u",
            "session_id": "s",
            "message": { "id": "m", "model": "claude-opus-4-8", "content": [] }
        }))
        .expect("valid assistant");

        match msg {
            SdkMessage::Assistant {
                is_api_error_message,
                api_error_status,
                ..
            } => {
                assert!(!is_api_error_message);
                assert_eq!(api_error_status, None);
            }
            other => panic!("expected assistant, got {other:?}"),
        }
    }
}
