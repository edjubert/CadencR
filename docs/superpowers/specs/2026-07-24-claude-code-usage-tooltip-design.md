# Design — Session cost & account quota in the context usage tooltip

**Date:** 2026-07-24
**Status:** Implemented (all 15 plan tasks landed as of commit 989391e0)
**Scope:** `packages/service` (Claude Code adapter, new REST route, migration), `packages/desktop` (context usage UI, generated API client)

> Reconstructed 2026-07-24 after the original file was lost from disk mid-implementation
> (untracked, wiped by an external checkpoint/reset mechanism unrelated to this session's own
> actions — confirmed via `git reflog` showing two `reset: moving to HEAD` events this session
> never issued). Content matches the original as faithfully as memory of the conversation allows.

## Problem

`ContextUsageBar` (`packages/desktop/src/components/ContextUsageBar.tsx`) showed only
the context-window fill ratio. It had no tooltip and surfaced no cost or account-level
usage information, even though:

- Claude Code's CLI already reports `total_cost_usd` on every turn's `Result` message
  (`claude-agent-sdk-rs/src/messages/sdk_message.rs`), but the value was discarded —
  `RuntimeEventMetadata`/`RuntimeUsage` only carried `input_tokens`/`output_tokens`.
- Anthropic exposes an undocumented, OAuth-only endpoint
  (`GET https://api.anthropic.com/api/oauth/usage`) that returns the account's
  Pro/Max quota utilization (`five_hour`, `seven_day`, `seven_day_sonnet`,
  `seven_day_opus`). This is how third-party tools (e.g. the open-source
  [Claude God](https://github.com/Lcharvol/Claude-God) menu-bar app) show quota —
  by reading the OAuth token Claude Code's own `claude login` writes to the macOS
  Keychain or `~/.claude/.credentials.json`, and calling that endpoint directly.

## Goal

The context usage tooltip (hover on `ContextUsageBar`) gains two independent panels:

1. **Session cost** — cumulative `$` for the current Cadencr session, live, no extra
   network call (rides the existing WebSocket usage stream).
2. **Account quota** — the account's `five_hour`/`seven_day`/... utilization,
   fetched on demand (tooltip open, or manual refresh), cached server-side with a
   60s freshness threshold, showing "fetched Ns ago".

Non-goals: OAuth token refresh (surfacing "reconnect via `claude login`" is enough),
quota support for non-OAuth (API-key/Bedrock/Vertex) profiles, a background poller.

## Architecture (as implemented)

Session cost: Claude Code `Result.total_cost_usd` → `SdkMessage::total_cost_usd()` →
`RuntimeEventMetadata.cost_usd` → `RuntimeUsageState` (cumulative, root-only) →
`agent_sessions.cost_usd` (persisted) → `SessionUsageUpdatePayload`/`SessionInitializedPayload`
(WS) → `ContextUsageState.costUsd` (frontend) → rendered in `ContextUsageBar`'s existing
popover.

Account quota: `domain::agents::claude_code::oauth_usage::{credentials, client, cache}` —
credentials resolves the OAuth token (macOS Keychain via `security`, Linux via
`~/.claude/.credentials.json`), client calls the Anthropic endpoint, cache TTL-caches
(60s, single-flight, `force=true` bypass) mirroring `providers/opencode/cache.rs`'s
idiom. Exposed via `GET /api/claude-code/oauth-usage[?force=true]`, consumed by
`useClaudeCodeOauthUsage()` and rendered in the same popover with a manual refresh
button (disabled while in flight).

## Key decisions made during design review

- Quota is account-wide, not per-session — one global REST route, no session id.
- Cost persists across reconnects (DB migration); quota does not persist (memory-only cache).
- No OAuth token refresh — out of scope, meaningfully riskier than read-only credential access.
- Error handling splits "not applicable" (no OAuth credentials → hide quota section, not an
  error) from "real failure" (network/401/5xx → visible "Quota unavailable right now" message).

## Implementation notes (discovered during execution, not in the original design)

- `ContextUsageBar.tsx` already had an in-component Popover (from prior work on this
  branch, named `llm-usage-tooltip`) by the time implementation reached the frontend —
  the design's planned separate `ContextUsageTooltip.tsx` wrapper was adapted into
  extending the existing `ContextUsageDetails()` instead.
- The popover's `PopoverContent` originally had `pointer-events-none` (never interactive
  before); adding a clickable refresh button required removing it and adding a short
  (150ms) close-grace timeout so the pointer can travel from the trigger to the button
  without the popover closing mid-transit.
- `useClaudeCodeOauthUsage`'s `refresh()` cannot simply call react-query's `refetch()` —
  that would replay the same (unforced) params. It calls `getClaudeCodeOauthUsage({force:
  true})` directly, then `refetch()` to pull the now-fresh backend cache entry into the
  polled query.

Full per-task detail (exact code, file paths, test cases) lives in the 16 commits on
`edjubert/llm-usage-tooltip` between `5a9526f8` and `989391e0` — `git log` and
`git show <sha>` are the authoritative record now that the plan file itself was lost.
