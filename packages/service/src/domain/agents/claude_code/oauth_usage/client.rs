//! Calls Anthropic's undocumented OAuth usage endpoint. This is
//! reverse-engineered (used internally by the Claude Code CLI's own UI, and
//! by third-party tools such as github.com/Lcharvol/Claude-God) — not a
//! published, stable API. If Anthropic changes the shape, `parse_usage_response`
//! is the single place to fix.

use std::time::Duration;

use serde::Deserialize;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

// `pub(crate)` (not `pub(super)`): `cache.rs` (this module's sibling) needs
// these, but so does `claude_code::routes` two levels up when it builds the
// HTTP response in Task 12 — it destructures `snapshot.five_hour.utilization`
// directly. Keeping this `pub(crate)` avoids a chain of re-exports through
// `oauth_usage/mod.rs` just to satisfy field-level privacy at every call site.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub(crate) struct QuotaWindow {
    pub(crate) utilization: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub(crate) struct OauthUsageSnapshot {
    pub(crate) five_hour: QuotaWindow,
    pub(crate) seven_day: QuotaWindow,
    pub(crate) seven_day_sonnet: QuotaWindow,
    pub(crate) seven_day_opus: QuotaWindow,
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
}

impl std::fmt::Display for OauthUsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAuthenticated => write!(f, "not authenticated via claude login"),
            Self::Http(msg) => write!(f, "network error: {msg}"),
            Self::Status(code) => write!(f, "unexpected status {code}"),
            Self::Parse(msg) => write!(f, "could not parse response: {msg}"),
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
pub(super) async fn fetch_usage(
    access_token: &str,
) -> Result<OauthUsageSnapshot, OauthUsageError> {
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
        return Err(OauthUsageError::Status(response.status().as_u16()));
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
            "five_hour": { "utilization": 0.42 },
            "seven_day": { "utilization": 0.10 },
            "seven_day_sonnet": { "utilization": 0.05 },
            "seven_day_opus": { "utilization": 0.0 }
        }"#
    }

    #[test]
    fn parse_usage_response_reads_all_four_windows() {
        let snapshot = parse_usage_response(sample_response()).unwrap();
        assert_eq!(snapshot.five_hour.utilization, 0.42);
        assert_eq!(snapshot.seven_day.utilization, 0.10);
        assert_eq!(snapshot.seven_day_sonnet.utilization, 0.05);
        assert_eq!(snapshot.seven_day_opus.utilization, 0.0);
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
}
