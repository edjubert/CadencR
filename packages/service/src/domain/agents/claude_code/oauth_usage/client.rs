//! Calls Anthropic's undocumented OAuth usage endpoint. This is
//! reverse-engineered (used internally by the Claude Code CLI's own UI, and
//! by third-party tools such as github.com/Lcharvol/Claude-God) — not a
//! published, stable API. If Anthropic changes the shape, `parse_usage_response`
//! is the single place to fix.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

// `pub(crate)` (not `pub(super)`): `cache.rs` (this module's sibling) needs
// these, but so does `claude_code::routes` two levels up when it builds the
// HTTP response in Task 12 — it destructures `snapshot.five_hour.utilization`
// directly. Keeping this `pub(crate)` avoids a chain of re-exports through
// `oauth_usage/mod.rs` just to satisfy field-level privacy at every call site.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub(crate) struct QuotaWindow {
    pub(crate) utilization: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct OauthUsageSnapshot {
    pub(crate) five_hour: Option<QuotaWindow>,
    pub(crate) seven_day: Option<QuotaWindow>,
    pub(crate) seven_day_sonnet: Option<QuotaWindow>,
    pub(crate) seven_day_opus: Option<QuotaWindow>,
    pub(crate) seven_day_opus_2: Option<QuotaWindow>,
    pub(crate) seven_day_sonnet_2: Option<QuotaWindow>,
}

impl Default for OauthUsageSnapshot {
    fn default() -> Self {
        Self {
            five_hour: None,
            seven_day: None,
            seven_day_sonnet: None,
            seven_day_opus: None,
            seven_day_opus_2: None,
            seven_day_sonnet_2: None,
        }
    }
}

impl serde::Serialize for OauthUsageSnapshot {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(4))?;
        macro_rules! write_window {
            ($field:ident, $key:expr) => {
                if let Some(window) = self.$field {
                    map.serialize_entry($key, &window)?;
                }
            };
        }
        write_window!(five_hour, "five_hour");
        write_window!(seven_day, "seven_day");
        write_window!(seven_day_sonnet, "seven_day_sonnet");
        write_window!(seven_day_opus, "seven_day_opus");
        write_window!(seven_day_opus_2, "seven_day_opus_2");
        write_window!(seven_day_sonnet_2, "seven_day_sonnet_2");
        map.end()
    }
}

impl<'de> serde::Deserialize<'de> for OauthUsageSnapshot {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct RawSnapshot {
            five_hour: Option<Option<QuotaWindow>>,
            seven_day: Option<Option<QuotaWindow>>,
            seven_day_sonnet: Option<Option<QuotaWindow>>,
            seven_day_opus: Option<Option<QuotaWindow>>,
            seven_day_opus_2: Option<Option<QuotaWindow>>,
            seven_day_sonnet_2: Option<Option<QuotaWindow>>,
        }
        let raw = RawSnapshot::deserialize(deserializer)?;
        Ok(OauthUsageSnapshot {
            five_hour: raw.five_hour.flatten(),
            seven_day: raw.seven_day.flatten(),
            seven_day_sonnet: raw.seven_day_sonnet.flatten(),
            seven_day_opus: raw.seven_day_opus.flatten(),
            seven_day_opus_2: raw.seven_day_opus_2.flatten(),
            seven_day_sonnet_2: raw.seven_day_sonnet_2.flatten(),
        })
    }
}

#[derive(Debug, Clone)]
pub(super) enum OauthUsageError {
    /// Not a failure — the session isn't authenticated via `claude login`
    /// (API-key/Bedrock/Vertex profile, or never logged in). `cache.rs` maps
    /// this to `UsageStatus::NotApplicable`, never `Unavailable`, so the
    /// frontend hides the quota section instead of showing an error.
    NotAuthenticated,
    Http(String),
    Status(u16),
    Parse(String),
    /// Anthropic's OAuth endpoint rejected the request due to rate
    /// limiting. The cache treats this as a transient failure and caches the
    /// error for the full TTL so the client stops hammering the endpoint.
    RateLimited,
}

impl std::fmt::Display for OauthUsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAuthenticated => write!(f, "not authenticated via claude login"),
            Self::Http(msg) => write!(f, "network error: {msg}"),
            Self::Status(code) => write!(f, "unexpected status {code}"),
            Self::Parse(msg) => write!(f, "could not parse response: {msg}"),
            Self::RateLimited => write!(
                f,
                "rate limited — too many attempts, please try again later"
            ),
        }
    }
}

fn parse_usage_response(body: &str) -> Result<OauthUsageSnapshot, OauthUsageError> {
    serde_json::from_str(body).map_err(|e| OauthUsageError::Parse(e.to_string()))
}

/// Production probe: real HTTP call. Not unit tested directly — `cache.rs`'s
/// tests inject a fake closure instead (same seam pattern as
/// `providers/opencode/cache.rs`), and this file's tests cover
/// `parse_usage_response` in isolation.
pub(super) async fn fetch_usage(access_token: &str) -> Result<OauthUsageSnapshot, OauthUsageError> {
    tracing::info!(url = USAGE_URL, "fetching claude code oauth usage");
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let response = client
        .get(USAGE_URL)
        .bearer_auth(access_token)
        .header("anthropic-beta", OAUTH_BETA_HEADER)
        .send()
        .await
        .map_err(|e| OauthUsageError::Http(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        // 429 from the OAuth usage endpoint means the CLI has been making
        // too many probe requests (e.g. repeated quota tooltip hovers).
        // Return a dedicated error so the cache can display a clear message
        // and stop the frontend from retrying aggressively.
        if status == 429 {
            return Err(OauthUsageError::RateLimited);
        }
        return Err(OauthUsageError::Status(status));
    }

    let body = response
        .text()
        .await
        .map_err(|e| OauthUsageError::Http(e.to_string()))?;
    parse_usage_response(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_response() -> &'static str {
        r#"{
            "five_hour": { "utilization": 100.0 },
            "seven_day": { "utilization": 72.0 },
            "seven_day_sonnet": { "utilization": 45.0 },
            "seven_day_opus": { "utilization": 0.0 },
            "seven_day_opus_2": null,
            "seven_day_sonnet_2": null
        }"#
    }

    #[test]
    fn parse_usage_response_handles_null_windows() {
        let snapshot = parse_usage_response(sample_response()).unwrap();
        assert!(snapshot.five_hour.is_some());
        assert!(snapshot.seven_day.is_some());
        assert!(snapshot.seven_day_sonnet.is_some());
        assert!(snapshot.seven_day_opus.is_some());
        assert!(snapshot.seven_day_opus_2.is_none());
        assert!(snapshot.seven_day_sonnet_2.is_none());
    }

    #[test]
    fn parse_usage_response_reads_all_four_windows() {
        let snapshot = parse_usage_response(sample_response()).unwrap();
        assert_eq!(snapshot.five_hour.unwrap().utilization, 100.0);
        assert_eq!(snapshot.seven_day.unwrap().utilization, 72.0);
        assert_eq!(snapshot.seven_day_sonnet.unwrap().utilization, 45.0);
        assert_eq!(snapshot.seven_day_opus.unwrap().utilization, 0.0);
    }

    #[test]
    fn parse_usage_response_rejects_malformed_json() {
        assert!(matches!(
            parse_usage_response("not json"),
            Err(OauthUsageError::Parse(_))
        ));
    }

    #[test]
    fn not_authenticated_has_a_readable_display() {
        assert_eq!(
            OauthUsageError::NotAuthenticated.to_string(),
            "not authenticated via claude login"
        );
    }

    #[test]
    fn rate_limited_has_a_readable_display() {
        assert_eq!(
            OauthUsageError::RateLimited.to_string(),
            "rate limited — too many attempts, please try again later"
        );
    }
}
