-- Nullable preserves legacy sessions whose effective values predate override provenance.
ALTER TABLE agent_sessions ADD COLUMN runtime_overrides TEXT;
