// Wired end-to-end by the REST route in `claude_code::routes` (Task 12 of
// the usage-tooltip plan). Until then nothing in production calls into this
// tree, so the whole module is allowed to be "unused" — remove this once
// the route handler consumes `live_usage`/`live_usage_force_refresh`.
#![allow(dead_code)]

mod cache;
mod client;
mod credentials;

#[allow(unused_imports)] // consumed by claude_code::routes starting Task 12
pub(super) use cache::{live_usage, live_usage_force_refresh, UsageCacheEntry, UsageStatus};
