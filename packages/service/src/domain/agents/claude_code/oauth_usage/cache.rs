//! TTL-cached snapshot of the account's OAuth usage quota. Mirrors the
//! pattern at `providers/opencode/cache.rs`: a process-wide `OnceLock` holds
//! the last snapshot, a refresh lock serializes concurrent misses into one
//! HTTP call, and probe failures are cached for the TTL too so a flaky
//! endpoint isn't hammered on every tooltip hover.
//!
//! Additionally enforces a per-request cooldown (`REFRESH_COOLDOWN`) so that
//! even forced refreshes never exceed 1 HTTP call per 60 seconds, protecting
//! the upstream API from 429 throttling.

use std::future::Future;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, RwLock};

use super::client::{fetch_usage, OauthUsageError, OauthUsageSnapshot};
use super::credentials::resolve_access_token;

const USAGE_TTL: Duration = Duration::from_secs(300);
const REFRESH_COOLDOWN: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub(crate) enum UsageStatus {
    Available(OauthUsageSnapshot),
    /// Not authenticated via `claude login` (API-key/Bedrock/Vertex profile,
    /// or never logged in) — expected, not a failure. The frontend hides the
    /// quota section entirely for this status instead of showing an error.
    NotApplicable,
    /// A real failure (network, non-2xx, malformed response). Human-readable
    /// reason, safe to show in the UI (e.g. "quota unavailable right now").
    Unavailable(String),
}

#[derive(Debug, Clone)]
pub(crate) struct UsageCacheEntry {
    pub(crate) status: UsageStatus,
    pub(crate) fetched_at: Instant,
}

static USAGE_CACHE: OnceLock<RwLock<Option<UsageCacheEntry>>> = OnceLock::new();
static USAGE_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static LAST_REQUEST_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn usage_cache() -> &'static RwLock<Option<UsageCacheEntry>> {
    USAGE_CACHE.get_or_init(|| RwLock::new(None))
}

fn usage_refresh_lock() -> &'static Mutex<()> {
    USAGE_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

fn last_request_at() -> &'static Mutex<Option<Instant>> {
    LAST_REQUEST_AT.get_or_init(|| Mutex::new(None))
}

/// Production entry point used by the route handler.
pub(crate) async fn live_usage() -> UsageCacheEntry {
    live_usage_entry_with(real_probe, false).await
}

/// Forced refresh entry point — bypasses the TTL check but still goes
/// through the single-flight lock, so a forced refresh never runs
/// concurrently with another cache write (each still issues its own probe;
/// the lock only serializes them, it does not deduplicate them).
pub(crate) async fn live_usage_force_refresh() -> UsageCacheEntry {
    live_usage_entry_with(real_probe, true).await
}

async fn real_probe() -> Result<OauthUsageSnapshot, OauthUsageError> {
    let Some(token) = resolve_access_token().await else {
        return Err(OauthUsageError::NotAuthenticated);
    };
    fetch_usage(&token).await
}

/// Probe seam. Tests inject a counting closure that returns `Ok`/`Err`
/// deterministically without spawning a real HTTP call.
async fn live_usage_entry_with<F, Fut>(probe: F, force: bool) -> UsageCacheEntry
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<OauthUsageSnapshot, OauthUsageError>>,
{
    if !force {
        if let Some(entry) = usage_cache().read().await.clone() {
            if entry.fetched_at.elapsed() < USAGE_TTL {
                return entry;
            }
        }
    }

    let _guard = usage_refresh_lock().lock().await;
    if !force {
        if let Some(entry) = usage_cache().read().await.clone() {
            if entry.fetched_at.elapsed() < USAGE_TTL {
                return entry;
            }
        }
    }

    // Enforce cooldown: never make an HTTP request more than once every
    // REFRESH_COOLDOWN, even on force refresh.  Returns the cached entry
    // (which may be stale) to avoid hammering the upstream API.
    {
        let last = last_request_at().lock().await;
        if let Some(last_instant) = *last {
            if last_instant.elapsed() < REFRESH_COOLDOWN {
                tracing::debug!(
                    "oauth usage probe throttled: last request {}ms ago (cooldown {}ms)",
                    last_instant.elapsed().as_millis(),
                    REFRESH_COOLDOWN.as_millis()
                );
                // Return cached entry if available, otherwise probe anyway
                // (first request has no cooldown constraint).
                if let Some(entry) = usage_cache().read().await.clone() {
                    return entry;
                }
            }
        }
    }

    let status = match probe().await {
        Ok(snapshot) => UsageStatus::Available(snapshot),
        Err(OauthUsageError::NotAuthenticated) => UsageStatus::NotApplicable,
        Err(error) => {
            tracing::warn!(error = %error, "claude code oauth usage probe failed");
            UsageStatus::Unavailable(error.to_string())
        }
    };
    let entry = UsageCacheEntry {
        status,
        fetched_at: Instant::now(),
    };
    *usage_cache().write().await = Some(entry.clone());
    *last_request_at().lock().await = Some(Instant::now());
    entry
}

/// Clear the OAuth usage cache and cooldown — used by the DELETE route so the
/// frontend can "expire" a stale 429 and retry.
pub async fn clear_oauth_cache() {
    *usage_cache().write().await = None;
    *last_request_at().lock().await = None;
}

#[cfg(test)]
pub(super) async fn reset_for_test() {
    *usage_cache().write().await = None;
    *last_request_at().lock().await = None;
}

#[cfg(test)]
pub(super) async fn force_expire_for_test() {
    let mut guard = usage_cache().write().await;
    if let Some(entry) = guard.as_mut() {
        entry.fetched_at = Instant::now() - USAGE_TTL - Duration::from_secs(1);
    }
}

#[cfg(test)]
pub(super) static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn sample_snapshot() -> super::super::client::OauthUsageSnapshot {
        use super::super::client::{OauthUsageSnapshot, QuotaWindow};
        OauthUsageSnapshot {
            five_hour: Some(QuotaWindow { utilization: 10.0 }),
            seven_day: Some(QuotaWindow { utilization: 10.0 }),
            seven_day_sonnet: Some(QuotaWindow { utilization: 10.0 }),
            seven_day_opus: Some(QuotaWindow { utilization: 10.0 }),
            seven_day_opus_2: None,
            seven_day_sonnet_2: None,
        }
    }

    #[tokio::test]
    async fn cache_returns_stale_entry_within_ttl() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_snapshot()) }
        };

        let first = live_usage_entry_with(&probe, false).await;
        let second = live_usage_entry_with(&probe, false).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first.fetched_at, second.fetched_at);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn cache_refreshes_after_ttl() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_snapshot()) }
        };

        let _ = live_usage_entry_with(&probe, false).await;
        force_expire_for_test().await;
        // Reset cooldown to allow refresh after TTL expires.
        *last_request_at().lock().await = None;
        let _ = live_usage_entry_with(&probe, false).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn force_bypasses_ttl_but_still_calls_probe_once_per_request() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_snapshot()) }
        };

        let _ = live_usage_entry_with(&probe, false).await;
        // Reset cooldown to allow a second request (simulates cooldown expiry).
        *last_request_at().lock().await = None;
        let _ = live_usage_entry_with(&probe, true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn rapid_force_refreshes_are_throttled_within_cooldown() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_snapshot()) }
        };

        // First request should always succeed (no prior request to throttle).
        let first = live_usage_entry_with(&probe, true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // Immediate second force refresh should be throttled (returns cached entry).
        let second = live_usage_entry_with(&probe, true).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1); // No additional probe call
        assert_eq!(second.fetched_at, first.fetched_at); // Same cached entry

        reset_for_test().await;
    }

    #[tokio::test]
    async fn probe_failure_is_cached_as_unavailable() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(super::super::client::OauthUsageError::Status(401)) }
        };

        let first = live_usage_entry_with(&probe, false).await;
        assert!(matches!(first.status, UsageStatus::Unavailable(_)));

        let _ = live_usage_entry_with(&probe, false).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn not_authenticated_is_cached_as_not_applicable_not_unavailable() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let probe = || async { Err(super::super::client::OauthUsageError::NotAuthenticated) };

        let entry = live_usage_entry_with(&probe, false).await;
        assert!(matches!(entry.status, UsageStatus::NotApplicable));

        reset_for_test().await;
    }

    #[tokio::test]
    async fn rate_limit_429_is_cached_as_unavailable_with_clear_message() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let probe = || async { Err(super::super::client::OauthUsageError::RateLimited) };

        let entry = live_usage_entry_with(&probe, false).await;
        match entry.status {
            UsageStatus::Unavailable(msg) => {
                assert!(
                    msg.contains("too many attempts"),
                    "expected rate limit message, got: {msg}"
                );
            }
            _ => panic!("expected Unavailable for 429, got {:?}", entry.status),
        }

        reset_for_test().await;
    }
}
