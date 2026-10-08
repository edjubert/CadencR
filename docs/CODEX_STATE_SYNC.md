# Codex session-state synchronization investigation

## Regression and corrective follow-up (2026-09-14)

The sections below this follow-up describe the earlier fix, not proof that it
covered upward messaging. The merged `bbf4cf234` change incorrectly treated
`subAgentActivity.kind = interacted` as a spawn edge.

### Proven failure

Production was opened read-only (`mode=ro` / `query_only`). The bounded snapshot
of **Archive Parent Child Conversations**, feature `2376`, session `3885`, ends
at message `2303356`; it is not a claim about later activity in that conversation.

1. Child `01a0a176-ae8e-7a72-8ce8-35d10e6bc46c` sent a message to root
   `01a0a173-455a-72a0-8100-13be6d11aec3` at `19:48:31.863 UTC`.
2. Its native `SubAgentActivity/interacted` item made the adapter register the
   **root** as a child of messaging call `call_mWd2XE0HwgfqP0CwO4Bc6Yza`.
3. Subsequent root content acquired that wrong `parent_tool_use_id`. Of the
   `1,210` rows through the cutoff, `587` are affected: `244` tool calls,
   `207` tool results, `124` thinking rows, and `12` text rows.
4. Root `turn/completed` was then suppressed as a child result. The poisoned
   route survived per-turn resets, explaining the persistent working state.
5. Separately, summary selected an empty last text block before compaction
   instead of the last nonblank answer (production message `2303091`).

This is primarily incorrect ancestry, not reversed database message IDs. Sorting
by timestamps or forcing idle in the frontend would mask symptoms, not repair
the fault.

### Implemented invariants

| Boundary               | Correction                                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root identity          | Reject root/empty child registrations; root lookup cannot return a child parent, even with a stale poisoned map.                                                                        |
| Messaging              | `interacted` never creates a spawn edge from its sender or messaging call. Known child routes are preserved.                                                                            |
| Unknown resumed target | Read `thread/read` metadata and prove its entire `thread_spawn` ancestry reaches the session root or an already verified descendant; register ancestor-first using real parents.        |
| Recovery limits        | Coalesce attempts per target/root turn; bound the whole lookup to three seconds and 64 ancestors; detect cycles and mismatched identities before changing routes.                       |
| Active recovered child | Consume the metadata's active status, even when no fresh child turn-start event arrives. Preserve existing deferred completion and Stop behavior.                                       |
| Failure/isolation      | Surface metadata failures as `CODEX_SUBAGENT_LINEAGE`; foreign/guardian/unresolved content and terminal events cannot become root content/completion. Preserve usage-accounting events. |
| Summary                | Select the last nonblank text, without hiding active streaming placeholders.                                                                                                            |

No polling, optimistic frontend status, dependency change, automatic retry,
database migration, or automatic history rewrite was introduced. Provider-specific
behavior remains inside the Codex adapter. The frontend still consumes only the
canonical `session_status` stream for working/idle state.

### Initial regression verification (2026-09-14)

| Check                                                 | Result                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex adapter unit tests                              | 237 passed                                                                                                                                                                        |
| Stream-reader / canonical status / history repository | 42 / 17 / 81 passed                                                                                                                                                               |
| Complete desktop test suite                           | 639 files, 4,897 tests passed                                                                                                                                                     |
| Summary/display subset                                | 40 tests passed (included in the desktop suite)                                                                                                                                   |
| Read-only repair planner                              | 4 tests passed; exact IDs, stable hashes, bounded cutoff, real children and unrelated sessions preserved                                                                          |
| Subprocess integration                                | One automated integration test covers eight scenarios through HTTP/WS, persistence, and history hydration                                                                         |
| Live development app                                  | Eight HTTP/WS scenarios passed on a new isolated DB; second root turn and reconnect snapshots also verified                                                                       |
| Chrome UI                                             | Summary enabled through Settings; compaction order survives reload; parent and next-turn answers remain outside the child recap; active child shows working and Stop returns idle |

Workspace lint/provider boundaries, desktop type-check/Knip, formatting, and
diff-whitespace checks passed. Turbo emitted sandbox IO warnings but all six
lint tasks succeeded; these were not compiler or linter failures.

The deterministic fixture covers `legacy` (no thread-status notifications),
`upward`, `sibling`, `resumed`, `stop-status`, `read-failure`, `foreign`, and
`summary`. It launches no model or delegated agents and executes no tools.
This does not claim live native multi-agent scheduler coverage or execution of
older CLI binaries. Chrome console checks found no errors or warnings in the
tested conversation pages. Development-server startup reports existing route-file
warnings; the initial QA script's numeric session ID and missing fixture skill
catalog were corrected before the successful replay.

```bash
pnpm rust -- test -p cadencr-service --test codex_conversation_state_test -- --nocapture
node --test scripts/codex-conversation-repair.test.mjs
pnpm --filter @cadencr/desktop test
```

Live QA used `pnpm dev --filter=@cadencr/desktop` plus a separately started service
with explicit isolated `--db-path` and `--settings-dir`; the existing worktree DB
was not used or replaced. Logs and the exact production dry-run manifest are in
`/tmp/cadencr-conversation-sync-qa/`. The integration test prints its preserved
temporary database directory.
The QA-owned service/frontend were stopped, ports `5105`/`1426` verified closed,
and the QA Chrome tab closed. All database files were preserved.

### Finish-job review hardening (2026-09-15)

- Continue draining the SDK broadcast during metadata recovery and replay the
  queued events in order. This prevents the three-second metadata wait from
  overflowing the SDK's 512-event ring. The queue is bounded at 8,192 events and
  an estimated 16 MiB retained payload; overflow or detected event loss ends the
  stream with a visible error, never a silent success. Queued events, including
  approvals, wait for the bounded lookup rather than overtaking unresolved ancestry.
- Share strict spawn-parent validation between live routes and recovery: reject
  missing, malformed or conflicting task parents; keep valid foreign/guardian
  metadata distinct from corrupt task metadata.
- Ignore foreign senders' activity even when it targets an already tracked child.
- Reuse the canonical WebSocket envelope in integration tests.
- Index only repair-anchor metadata and fetch content only for exact candidates;
  reject duplicate spawn anchors. The planner remains strictly read-only.

Final verification after the review:

| Check                                               | Result                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex adapter unit tests                            | 244 passed, including burst/approval ordering, queue limits, malformed ancestry and foreign lifecycle events                                       |
| Stream-reader / session-status / repository filters | 42 / 17 / 181 passed                                                                                                                               |
| Complete desktop suite                              | 639 files / 4,897 tests passed                                                                                                                     |
| Summary/display subset / repair planner             | 40 / 6 passed                                                                                                                                      |
| Subprocess integration                              | 12 scenarios passed, plus a subsequent root turn                                                                                                   |
| Live dev HTTP/WS replay                             | 12 scenarios passed on a new isolated database                                                                                                     |
| UI                                                  | Summary order survives reload; parent and next-turn answers stay visible outside child recaps; recovered child keeps working until Stop, then idle |
| Static checks                                       | Workspace lint, desktop type-check/Knip, formatting, provider boundaries and diff whitespace checks passed                                         |

The integration fixture now also covers `burst` (1,600 deltas while `thread/read`
waits two seconds), `read-timeout`, `missing-parent`, and `conflicting-parent`.
The queue unit test preserves an approval and completion after the burst.
A dev-console orphan-delta warning was traced to the fixture omitting
`item/started`; the fixture was corrected, integration and UI Stop were replayed,
and that stream warning disappeared. Chrome still reports CSP/meta,
non-desktop runtime-config and navigation-time WebSocket warnings; this is not a
claim of a warning-free browser run. No native model or native scheduler was used.

Current live QA artifacts: `/tmp/cadencr-finish-job-qa-20260915-7epuj8ja/`.
Rust/test/check logs: `/tmp/finish-job-*.log`. QA databases are preserved.
The QA-owned frontend/service and Chrome tab were closed; ports `1426`/`5105`
were verified to have no listener.

### Existing production history: read-only planner

`scripts/codex-conversation-repair.mjs` is deliberately **dry-run only**. It requires
native root/child rollout evidence, session identity, and an explicit message-ID
cutoff. It verifies the real child spawn and messaging anchors, and emits exact
candidate IDs plus content/row hashes, without printing message content.

```bash
node scripts/codex-conversation-repair.mjs \
  --database "$HOME/.cadencr/database/cadencr.db" \
  --session 3885 \
  --root-rollout /absolute/path/to/root-rollout.jsonl \
  --child-rollout /absolute/path/to/child-rollout.jsonl \
  --through-message-id 2303356
```

The planner cannot apply a manifest. Any repair is a separate operation requiring
explicit approval, a quiet affected runtime, an online SQLite backup and integrity
check, and transactional revalidation of every row/hash. Only proven wrong parent
pointers may change; content, ordering, and real child nesting must stay untouched.
Runtime reconciliation remains separate: a database edit cannot clear a poisoned
in-memory provider route.

### Authorized one-off production repair (2026-09-15)

A later approved manifest extended the cutoff to `2303523`: **672** wrong parent
pointers among **1,296** session rows, including 85 subsequent rows independently
matched to the native root history. The completed transaction changed only
`agent_messages.parent_tool_use_id`, in 0.087 seconds. Content, IDs, ordering,
real children, session status (`paused`), revisions, schema and migration bookkeeping
were preserved. Post-write checks found no remaining wrong pointer, integrity
`ok`, and no foreign-key violations.

The full online backup and one-off write/audit scripts were preserved outside the
repository under `~/.cadencr/backups/codex-parent-repair-20260915-453ilfsl/`.
Five safety tests and two full-copy rehearsals preceded the write; each rehearsal
compared 41 tables / 1,376,955 rows and found only the 672 planned column changes.
No write script or temporary migration is shipped with this change.

**Fully reload the conversation/window after this kind of repair.**
`content_revision` / `message_revision` only drive incremental mutable tool-input
content updates; that protocol does not carry ancestry. Bumping these revisions
would not refresh parent pointers and is deliberately not part of the repair.
The runtime fix must still be integrated to prevent recurrence.

### Files changed in this follow-up

- `packages/desktop/src/components/agentStreamSummary.ts`
- `packages/desktop/src/components/agentStreamSummary.test.ts`
- `packages/service/src/domain/agents/codex/event_state.rs`
- `packages/service/src/domain/agents/codex/event_state/subagents.rs`
- `packages/service/src/domain/agents/codex/event_subagent_activity.rs`
- `packages/service/src/domain/agents/codex/event_subagent_routes.rs`
- `packages/service/src/domain/agents/codex/event_subagent_routes/ancestry.rs`
- `packages/service/src/domain/agents/codex/event_subagent_recovery.rs`
- `packages/service/src/domain/agents/codex/event_lifecycle.rs`
- `packages/service/src/domain/agents/codex/event_lifecycle/children.rs`
- `packages/service/src/domain/agents/codex/event_loop.rs`
- `packages/service/src/domain/agents/codex/event_loop/buffer.rs`
- `packages/service/src/domain/agents/codex/events/mod.rs`
- `packages/service/src/domain/agents/codex/mod.rs`
- `packages/service/tests/codex_conversation_state_test.rs`
- `packages/service/tests/fixtures/fake_codex_conversation.py`
- `scripts/codex-conversation-repair.mjs`
- `scripts/codex-conversation-repair.test.mjs`
- `docs/CODEX_STATE_SYNC.md`

## Evidence (2026-09-12)

Production was queried read-only. No production session was resumed, interrupted,
or modified during this investigation.

- Installed binary: `codex-cli 0.154.0`.
- Conversation: **Define Provider Boundary Spec**, feature `2284`, session `3793`.
- Root runtime thread: `019fc2bc-6c05-7db2-8933-46942a31af27`.
- At `10:03:30 UTC` the root emitted `task_complete`; the persisted Cadencr
  session became `completed` at the same time.
- Its children continued until `10:03:50`, `10:06:19`, and `10:08:17 UTC`.
  Their content was still arriving after the persisted end time, sometimes with
  no `parent_tool_use_id`.
- The resumed work was announced as `subAgentActivity.kind = interacted`
  (`followup_task`), not a fresh spawn. Cadencr previously ignored this kind.
- An earlier root turn ended at `07:11:11 UTC` with
  `Selected model is at capacity. Please try a different model.` Cadencr's
  `turn/completed` conversion previously discarded the turn's error entirely.

The native root rollout contains no automatically started root turn after those
children finished. Later root turns were user initiated. A successful final
answer, a provider capacity failure, and a running descendant are distinct facts:
a UI fix must not manufacture a new user instruction or retry an unsuccessful
model request.

## Sources and compatibility

- [Official Codex changelog](https://learn.chatgpt.com/docs/changelog): CLI
  `0.154.0` released September 9; earlier entries describe parent sub-agent
  completion activity and reloading multi-agent children through the parent.
- [Official App Server documentation](https://learn.chatgpt.com/docs/app-server):
  consume `thread/status/changed`, thread lifecycle, and turn notifications;
  thread status and an individual turn's terminal result are different signals.
- The installed binary's schema was generated with
  `codex app-server generate-json-schema --experimental`. Its sub-agent activity
  kinds are `started`, `interacted`, `interrupted`, and `completed`.

This establishes missing integration behavior, not the exact upstream release
that first introduced each symptom. There is no version-string gate or raised
minimum CLI version in the correction. Existing `turn/*`, raw spawn, collab-tool,
and legacy result-synthesis paths remain supported. Unknown thread status values
are ignored rather than treated as successful completion.

## Correction

| Area                | Behavior                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root identity       | Seed it from the actual session, not the first multiplexed turn.                                                                                             |
| Descendant routing  | Recover routes from resumed `thread/started` and `interacted` activity; preserve known routes and exclude Guardian/review sources.                           |
| Completion          | Defer the root's terminal event while known children run, then finish when the last child finishes, even if Codex never restarts the parent.                 |
| Autonomous activity | Accept explicit thread status as well as legacy turn boundaries; use a provider-neutral activity signal so both the WS state and DB snapshot become running. |
| Failure             | Surface terminal root/child errors; a slow child does not delay reporting a root failure.                                                                    |
| Stop                | Interrupt root and children concurrently with bounded requests; resolve status-only child turns on Stop and surface unresolved/failing targets.              |
| Coordination        | Instruct Codex to collect required delegated results before finalizing; preserve explicit background handoffs and status-only replies.                       |

Provider-specific changes remain in the Codex adapter. Shared changes are limited
to the provider-neutral turn-start source enum and scoped error deduplication:
an error nested under a child must not suppress a separate root error.
The frontend retains its single `session_status` source of truth. No optimistic
state, polling timer, dependency upgrade, SDK protocol change, or database
migration is introduced. No autonomous prompt is injected after completion.

## Verification scope

- Unit coverage includes legacy root-only completion, missing `threadId`,
  multiple concurrent children, root resumption, status-only activity, resumed
  child routing, child completion without root auto-resumption, failures, and
  parent-reported activity without a child stream.
- Live HTTP/WebSocket QA uses an isolated database and a deterministic fake CLI
  to reproduce legacy completion, a completed parent with two running children,
  reconnect snapshots, persisted child nesting, capacity errors, and Stop.
- Live CLI verification and final check results are reported separately in the
  investigation handoff. Deterministic protocol replay is not proof that every
  older CLI binary or the provider's internal multi-agent scheduler was tested.

### Final results

| Check                               | Result                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Codex adapter unit tests            | 231 passed                                                                                                                           |
| Canonical session-status unit tests | 11 passed                                                                                                                            |
| Stream-reader unit tests            | 42 passed                                                                                                                            |
| Isolated HTTP/WebSocket replay      | 8 passed: legacy, concurrent children, late restart, terminal error, Stop, status-only Stop, unresolved Stop, child then root errors |
| Native CLI `0.154.0`                | Minimal no-tools/no-subagents turn returned `STATE_SYNC_OK`; active-to-idle verified                                                 |
| Static checks                       | Workspace lint, desktop type-check/Knip, Rust formatting, provider boundaries, diff whitespace                                       |

No frontend visual QA, full repository test suite, or execution of older CLI
binaries is claimed. Knip reported configuration hints, not unused-code failures.
QA transcripts and service logs are under `/tmp/cadencr-codex-sync-qa/`.

### Changed files

All source paths below are relative to `packages/service/src/domain/agents/`.

- `adapter/event_types.rs`
- `codex/event_lifecycle.rs`
- `codex/event_loop.rs`
- `codex/event_state.rs`
- `codex/event_subagent_activity.rs`
- `codex/event_subagent_routes.rs`
- `codex/event_turn_state.rs`
- `codex/events/mod.rs`
- `codex/events/signals.rs`
- `codex/instructions.rs`
- `codex/mod.rs`
- `codex/session.rs`
- `codex/session/interrupt.rs`

Additional provider-neutral source files:

- `packages/service/src/domain/ws_session/handler/session_prompt/stream_reader_task_event.rs`
- `packages/service/src/domain/ws_session/handler/session_prompt/stream_reader_turn_state.rs`
- This report: `docs/CODEX_STATE_SYNC.md`.

## Finish-job review (2026-09-13)

Three independent reviews covered reuse, quality, and efficiency. Follow-up fixes:

- Reuse the canonical parent setter for rehydrated grandchildren, preserving both
  the typed and raw nesting identifiers.
- Scope error deduplication to the root: child errors remain visible without
  hiding a subsequent distinct root failure.
- Keep status-only active children in the interrupt snapshot; resolve their latest
  turn using `thread/read` only when Stop is requested. Missing turns/read errors
  are reported, not silently treated as a successful interruption.
- Dispatch interrupts with concurrency capped at eight and a bounded timeout per
  RPC, so a stalled child cannot delay sending Stop to the root. Aggregate errors
  after attempting the targets. Preserve the legacy stale-root fallback.

New inline regressions cover grandchild nesting, child/root error scoping,
concurrent interrupt dispatch, aggregation of failures, empty/successful targets,
and latest-turn resolution with a missing-turn error. The isolated replay adds
status-only Stop, unresolved Stop, and distinct child/root failures.

Final finish-job verification: 284 targeted Rust tests passed (231 Codex, 42
stream-reader, 11 canonical status), with no `FAILED` result. All eight isolated
HTTP/WebSocket scenarios and the native minimal turn passed on the rebuilt
service. QA services were stopped and ports `5116`/`5117` verified closed. Logs:
`/tmp/cadencr-codex-sync-qa/finish-job-results.log` and
`/tmp/cadencr-codex-sync-qa/finish-job-real-results.log`.
