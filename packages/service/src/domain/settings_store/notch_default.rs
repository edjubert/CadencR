//! One-time switch of macOS installs to the notch island as the destination
//! for agent notifications.
//!
//! The notch became the default after users already had a stored
//! `notification_mode`, so a changed in-code default alone would never reach
//! them. This runs once per settings file (guarded by `notch_default_applied`)
//! and leaves an explicit "off" alone: silencing notifications is a choice the
//! new default must not override. Every later pick in Settings is respected.

use crate::error::AppError;

use super::store::{global_set, global_snapshot};

const MODE_KEY: &str = "notification_mode";
const APPLIED_KEY: &str = "notch_default_applied";

/// Apply the notch default on macOS. Returns whether the mode was switched.
pub async fn apply_notch_default() -> Result<bool, AppError> {
    apply_notch_default_for(cfg!(target_os = "macos")).await
}

async fn apply_notch_default_for(notch_capable: bool) -> Result<bool, AppError> {
    if !notch_capable {
        return Ok(false);
    }
    // An unreadable file (hand-edit typo) is left for the user to fix rather
    // than overwritten on their behalf.
    let Some(values) = global_snapshot() else {
        return Ok(false);
    };
    if values.get(APPLIED_KEY).map(String::as_str) == Some("true") {
        return Ok(false);
    }
    let switch = values.get(MODE_KEY).map(String::as_str) != Some("off");
    if switch {
        global_set(MODE_KEY, "notch").await?;
    }
    global_set(APPLIED_KEY, "true").await?;
    Ok(switch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::settings_store::global_get;

    #[tokio::test]
    async fn switches_an_unset_or_explicit_mode_once() {
        global_set(MODE_KEY, "native").await.unwrap();
        assert!(apply_notch_default_for(true).await.unwrap());
        assert_eq!(global_get(MODE_KEY).as_deref(), Some("notch"));
        assert_eq!(global_get(APPLIED_KEY).as_deref(), Some("true"));

        // A later choice in Settings sticks across restarts.
        global_set(MODE_KEY, "in_app").await.unwrap();
        assert!(!apply_notch_default_for(true).await.unwrap());
        assert_eq!(global_get(MODE_KEY).as_deref(), Some("in_app"));
    }

    #[tokio::test]
    async fn fresh_install_gets_the_notch() {
        assert!(apply_notch_default_for(true).await.unwrap());
        assert_eq!(global_get(MODE_KEY).as_deref(), Some("notch"));
    }

    #[tokio::test]
    async fn keeps_notifications_off() {
        global_set(MODE_KEY, "off").await.unwrap();
        assert!(!apply_notch_default_for(true).await.unwrap());
        assert_eq!(global_get(MODE_KEY).as_deref(), Some("off"));
        assert_eq!(global_get(APPLIED_KEY).as_deref(), Some("true"));
    }

    #[tokio::test]
    async fn other_platforms_are_untouched() {
        global_set(MODE_KEY, "native").await.unwrap();
        assert!(!apply_notch_default_for(false).await.unwrap());
        assert_eq!(global_get(MODE_KEY).as_deref(), Some("native"));
        assert_eq!(global_get(APPLIED_KEY), None);
    }
}
