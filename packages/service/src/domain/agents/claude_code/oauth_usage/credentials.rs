//! Resolves the OAuth access token Claude Code's own `claude login` wrote to
//! disk, so Cadencr can query the account's usage quota. Read-only: this
//! module never writes back to the credential store (no token refresh — see
//! the design spec's Non-goals).

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct CredentialsFile {
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OauthTokenSet>,
}

#[derive(Debug, Deserialize)]
struct OauthTokenSet {
    #[serde(rename = "accessToken")]
    access_token: String,
}

/// Pure parsing seam, unit-tested without touching the filesystem/Keychain.
fn parse_access_token(raw: &str) -> Option<String> {
    let parsed: CredentialsFile = serde_json::from_str(raw).ok()?;
    parsed.claude_ai_oauth.map(|set| set.access_token)
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

/// Production entry point: resolves the OAuth access token, or `None` if the
/// user isn't authenticated via `claude login` on this machine.
pub(super) fn resolve_access_token() -> Option<String> {
    parse_access_token(&read_raw_credentials()?)
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
}
