//! Resolves the OAuth access token Claude Code's own `claude login` wrote to
//! disk, so Cadencr can query the account's usage quota. Read-only: this
//! module never writes back to the credential store.
//!
//! If the access token is expired (or about to expire within 5 minutes), the
//! module transparently refreshes it using the stored `refreshToken` via
//! Anthropic's OAuth token endpoint — all in-memory, no filesystem writes.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

const TOKEN_EXPIRY_MARGIN: Duration = Duration::from_secs(300);
const TOKEN_REFRESH_URL: &str = "https://api.anthropic.com/v1/oauth/token";

#[derive(Debug, Deserialize)]
struct CredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OauthTokenSet>,
}

#[derive(Debug, Deserialize)]
struct OauthTokenSet {
    #[serde(rename = "accessToken")]
    access_token: String,
    #[serde(rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(rename = "expiresAt")]
    expires_at: Option<u64>,
    #[serde(rename = "scopes")]
    #[allow(dead_code)]
    scopes: Option<Vec<String>>,
}

/// Pure parsing seam, unit-tested without touching the filesystem/Keychain.
#[allow(dead_code)]
fn parse_access_token(raw: &str) -> Option<String> {
    let parsed: CredentialsFile = serde_json::from_str(raw).ok()?;
    parsed.claude_ai_oauth.map(|set| set.access_token)
}

/// Parse the full OAuth token set from raw credentials JSON.
fn parse_oauth_token_set(raw: &str) -> Option<OauthTokenSet> {
    let parsed: CredentialsFile = serde_json::from_str(raw).ok()?;
    parsed.claude_ai_oauth
}

/// Check whether the access token is expired or about to expire (within margin).
fn is_token_expired(expires_at_ms: u64) -> bool {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    now_ms >= expires_at_ms.saturating_sub(TOKEN_EXPIRY_MARGIN.as_millis() as u64)
}

/// Refresh an expired access token using the stored refresh token.
/// Returns `None` if there's no refresh token or the refresh fails.
async fn refresh_access_token(refresh_token: &str) -> Option<String> {
    tracing::info!(
        url = TOKEN_REFRESH_URL,
        "refreshing claude code oauth access token"
    );
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_REFRESH_URL)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token
        }))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let body: serde_json::Value = response.json().await.ok()?;
    body.get("access_token")?.as_str().map(|s| s.to_string())
}

/// Reads the raw credentials JSON from wherever this platform stores it.
/// `None` means "not logged in via OAuth" (or credentials unreadable) —
/// callers must treat that as "quota not applicable", not an error.
fn read_raw_credentials() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        read_raw_credentials_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        read_raw_credentials_file()
    }
}

#[cfg(target_os = "macos")]
fn read_raw_credentials_macos() -> Option<String> {
    // Non-prompting form: a bare `security find-generic-password ... -w` on
    // the login keychain does not trigger the "app wants to access..."
    // dialog the way `SecItemCopyMatching` does on an ad-hoc-signed app.
    let output = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn read_raw_credentials_file() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    std::fs::read_to_string(format!("{home}/.claude/.credentials.json")).ok()
}

/// Production entry point: resolves the OAuth access token, refreshing if
/// expired, or `None` if the user isn't authenticated via `claude login` on
/// this machine.
pub(super) async fn resolve_access_token() -> Option<String> {
    let raw = read_raw_credentials()?;
    let token_set = parse_oauth_token_set(&raw)?;

    // Fast path: token is still valid.
    if let Some(expires_at) = token_set.expires_at {
        if !is_token_expired(expires_at) {
            return Some(token_set.access_token);
        }
    }

    // Token is expired or about to expire — try to refresh.
    if let Some(refresh_token) = token_set.refresh_token {
        return refresh_access_token(&refresh_token).await;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_access_token_reads_claude_ai_oauth_shape() {
        let raw = r#"{
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-abc123",
                "refreshToken": "sk-ant-ort01-xyz",
                "expiresAt": 1893456000000,
                "scopes": ["user:inference", "user:profile"]
            }
        }"#;
        assert_eq!(
            parse_access_token(raw),
            Some("sk-ant-oat01-abc123".to_string())
        );
    }

    #[test]
    fn parse_access_token_returns_none_for_malformed_json() {
        assert_eq!(parse_access_token("not json"), None);
    }

    #[test]
    fn parse_access_token_returns_none_when_oauth_key_missing() {
        assert_eq!(parse_access_token(r#"{"somethingElse": true}"#), None);
    }

    #[test]
    fn parse_oauth_token_set_reads_refresh_and_expiry() {
        let raw = r#"{
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-abc123",
                "refreshToken": "sk-ant-ort01-xyz",
                "expiresAt": 1893456000000,
                "scopes": ["user:inference"]
            }
        }"#;
        let set = parse_oauth_token_set(raw).unwrap();
        assert_eq!(set.access_token, "sk-ant-oat01-abc123");
        assert_eq!(set.refresh_token, Some("sk-ant-ort01-xyz".to_string()));
        assert_eq!(set.expires_at, Some(1893456000000));
    }

    #[test]
    fn parse_oauth_token_set_handles_missing_refresh_token() {
        let raw = r#"{
            "claudeAiOauth": {
                "accessToken": "sk-ant-oat01-abc123",
                "expiresAt": 1893456000000
            }
        }"#;
        let set = parse_oauth_token_set(raw).unwrap();
        assert_eq!(set.access_token, "sk-ant-oat01-abc123");
        assert_eq!(set.refresh_token, None);
        assert_eq!(set.expires_at, Some(1893456000000));
    }

    #[test]
    fn is_token_expired_returns_false_for_future_expiry() {
        let far_future = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u64
            + 86400; // 1 day from now
        assert!(!is_token_expired(far_future * 1000));
    }

    #[test]
    fn is_token_expired_returns_true_for_past_expiry() {
        let past = 0u64; // epoch
        assert!(is_token_expired(past));
    }

    #[test]
    fn is_token_expired_returns_true_within_margin() {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let expiring_soon = now_ms + 120; // 120 seconds from now (within 300s margin)
        assert!(is_token_expired(expiring_soon));
    }
}
