# Claude Code Usage Tooltip — As-Built Record

> The original 15-task TDD implementation plan (with full code per step) was lost from
> disk mid-execution: it was untracked (kept uncommitted at the user's request during
> planning), and an external checkpoint/reset mechanism wiped it along with the design
> spec — confirmed via `git reflog` showing two `reset: moving to HEAD` events this
> session never issued itself. All 15 tasks had already been implemented, tested, and
> committed by that point, so no code was lost — only the planning document. This file
> is a reconstructed as-built record, not a re-creation of the original plan's full
> code listings. The 16 commits below are the authoritative detail now.

**Goal:** Show the current Cadencr session's cumulative cost ($) and the Claude Code
account's OAuth quota (5h/7d utilization) in a hover popover on `ContextUsageBar`, with
a manual refresh action for the quota panel.

**Design spec:** `docs/superpowers/specs/2026-07-24-claude-code-usage-tooltip-design.md`
(also reconstructed).

## Commits (branch `edjubert/llm-usage-tooltip`, base `5a9526f8`)

| Task | Commit | Subject |
|---|---|---|
| 1 | `205cf140` | feat(service): add cost_usd column to agent_sessions |
| 2 | `b3bc0d4e` | feat(claude-agent-sdk-rs): add SdkMessage::total_cost_usd accessor |
| 3 | `00b1fef8` | feat(service): thread cost_usd through RuntimeEvent for Claude Code |
| 4 | `0c261932` | feat(service): track cumulative session cost in RuntimeUsageState |
| 5 | `a724b6c1` | feat(service): persist and seed session cost_usd |
| 6 | `1a636cd7` | feat(service): ship cost_usd over the session WebSocket envelope |
| 7 | `d5955eab` | feat(desktop): thread costUsd through ContextUsageState |
| 8 | `bd3d90fb` | feat(desktop): show session cost in the context usage popover |
| 9 | `cc02354b` | feat(service): resolve Claude Code OAuth token from Keychain/credentials file |
| 10 | `295e74c4` | feat(service): call Anthropic's OAuth usage endpoint |
| 11 | `36065138` | feat(service): TTL-cache the Claude Code OAuth usage probe |
| 12 | `2e16450d` + `957eee70` | feat(service): add GET /api/claude-code/oauth-usage route (+ fixup: drop stale dead_code allowance) |
| 13 | `8ba57d50` | chore(desktop): regenerate API client for oauth-usage route |
| 14 | `980962d1` | feat(desktop): add useClaudeCodeOauthUsage hook |
| 15 | `989391e0` | feat(desktop): show account quota with manual refresh in the usage popover |

## What each task actually built

1. **Migration + `SessionRow`** — `cost_usd REAL NOT NULL DEFAULT 0` on `agent_sessions`.
   Found and fixed mid-task: `session_init_restore.rs`'s `test_state()` had a *second*,
   independent inline `CREATE TABLE agent_sessions` (duplicated from `session_queries.rs`'s
   test schema) that was missing the column — the query silently failed against it,
   which hung a test on `rx.recv().await` waiting for a message that never came. Same
   fix applied to two other duplicated test schemas (`ws_session/handler/tests/support.rs`,
   `shared/migrate/custom_model_effort_migration_tests.rs`).
2. **SDK accessor** — `SdkMessage::total_cost_usd()` reading `Result.total_cost_usd`.
3. **`RuntimeEvent::cost_usd()`** — provider-neutral field on `RuntimeEventMetadata`,
   populated only by the Claude Code adapter. Required updating ~32 files' struct
   literals across the adapter/runtime tree (compiler-driven, not guessed).
4. **`RuntimeUsageState`** — cumulative cost snapshot, overwrite semantics (Result's
   `total_cost_usd` is already a running total, not a delta). Dropped `Eq` derive on
   `RuntimeUsageSnapshot`/`RuntimeUsageUpdate` (f64 isn't `Eq`).
5. **Persist + seed** — `WsSessionPersistence::update_cost_usd`, seeded on stream-reader
   startup from the DB row (mirrors `initial_context_window`).
6. **WS envelope** — `cost_usd` added to `SessionUsageUpdatePayload` and
   `SessionInitializedPayload`.
7. **Frontend type** — `ContextUsageState.costUsd`. Discovered the REST session-list
   paths (`UnifiedAgentCard.tsx`, `useWebSocketSession.ts` persisted-state restore)
   don't carry `cost_usd` — set `costUsd: null` there with a comment; only the live WS
   envelopes carry it.
8. **Cost UI** — discovered `ContextUsageBar.tsx` already had an in-component Popover
   from prior work on this branch (branch name: `llm-usage-tooltip`) — adapted the
   design's planned separate `ContextUsageTooltip.tsx` wrapper into extending the
   existing `ContextUsageDetails()` instead.
9. **`oauth_usage::credentials`** — macOS Keychain (`security find-generic-password`,
   non-prompting form) / Linux `~/.claude/.credentials.json`, pure-parsing seam tested
   without touching the filesystem.
10. **`oauth_usage::client`** — `reqwest` call to `api.anthropic.com/api/oauth/usage`
    with the OAuth beta header; `QuotaWindow`/`OauthUsageSnapshot` made `pub(crate)`
    (not `pub(super)`) so `claude_code::routes` can destructure fields two module
    levels up without a re-export chain.
11. **`oauth_usage::cache`** — TTL (60s) + single-flight refresh lock + `force` bypass,
    mirroring `providers/opencode/cache.rs`'s exact idiom. Failures cached for the TTL
    too (flaky endpoint isn't hammered every hover).
12. **REST route** — `GET /api/claude-code/oauth-usage[?force=true]`, wired into
    `claude_code_router()` and `openapi.rs`'s `paths`/`components(schemas(...))`.
13. **API client regen** — `pnpm --filter @cadencr/desktop run generate:api`; hook name
    landed exactly as predicted, `useGetClaudeCodeOauthUsage`.
14. **`useClaudeCodeOauthUsage` hook** — found and fixed a real design bug before
    committing: a naive `refresh() { query.refetch() }` would replay the *unforced*
    params and never actually force a refresh. Implemented as a direct
    `getClaudeCodeOauthUsage({ force: true })` call followed by `query.refetch()` to
    pull the now-fresh backend cache entry into the polled query.
15. **Quota UI + refresh** — found and fixed two real UX bugs before committing:
    `PopoverContent` had `pointer-events-none` (fine when nothing was interactive; a
    refresh button needs it removed), and removing it exposed a hover race — moving
    the pointer from the trigger button to the refresh button inside the portal-rendered
    content briefly leaves the trigger's DOM bounds, firing `onMouseLeave` and closing
    the popover before the click lands. Fixed with a 150ms close-grace timeout
    (cancelled on entering either the trigger or the content).

## Deviations from the original plan (as best recalled)

- Cost/quota UI landed inside the pre-existing `ContextUsageBar.tsx` popover, not a new
  `ContextUsageTooltip.tsx` component (Tasks 8, 15) — the plan predates a Popover that
  had since been added directly to `ContextUsageBar` by other work on this branch.
- `useClaudeCodeOauthUsage.refresh()` uses a direct forced fetch + refetch, not a bare
  `refetch()` (Task 14) — the plan's assumed implementation didn't actually force.
- The hover-close mechanism gained a 150ms grace timeout (Task 15) that wasn't in the
  original design.

## Verification performed

- `cargo build` / `cargo build --tests` clean after every backend task, zero
  `#[allow(dead_code)]` left in the final tree (temporary allowances during Tasks 10-11
  removed once Task 12 wired the consuming route).
- Full `cargo test` (packages/service): 2239 passed, 2 pre-existing failures unrelated
  to this work (`domain::git::service::graph`/`feature_branch` tests — local git-config
  environment issue, confirmed present on the base commit before this branch's changes).
- Full `pnpm --filter @cadencr/desktop vitest run`: 3736 tests passed, 491 files.
- `pnpm --filter @cadencr/desktop ts-check`: clean.
- `pnpm lint`: 0 errors (96 pre-existing warnings unrelated to touched files).
- Manual QA in a running app (`pnpm dev`, hovering the real tooltip, clicking refresh,
  switching to an API-key profile) was **not** performed — deferred at the user's
  explicit instruction ("bypass tests, applique tout, je suis afk") partway through
  execution. Recommended before merge.
