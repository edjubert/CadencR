-- Usage is sourced exclusively from provider-native token reports. The word
-- counters and conversation-message backfill marker belonged to the retired
-- text-derived accounting prototype and are no longer read by the service.
-- Rebuild the aggregate table so existing token totals survive unchanged.
CREATE TABLE provider_usage_stats_token_only (
    day TEXT NOT NULL,                            -- 'YYYY-MM-DD', UTC
    provider_id TEXT NOT NULL,                    -- e.g. 'claude_code', 'codex'
    model_id TEXT NOT NULL DEFAULT '',            -- '' when the provider never reported one
    thinking_effort TEXT NOT NULL DEFAULT '',     -- '' when the model has no effort levels
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (day, provider_id, model_id, thinking_effort)
);

INSERT INTO provider_usage_stats_token_only
    (day, provider_id, model_id, thinking_effort,
     input_tokens, output_tokens, updated_at)
SELECT day, provider_id, model_id, thinking_effort,
       input_tokens, output_tokens, updated_at
FROM provider_usage_stats;

DROP TABLE provider_usage_stats;
ALTER TABLE provider_usage_stats_token_only RENAME TO provider_usage_stats;

-- Restore the timeline-query index dropped with the old table.
CREATE INDEX idx_provider_usage_stats_day ON provider_usage_stats(day);

DROP TABLE provider_usage_backfill;
