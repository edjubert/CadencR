-- Give incremental hydration a durable cursor for in-place message edits.
-- Message ids alone cannot observe tool inputs that continue growing after
-- their original agent_messages row was inserted.

ALTER TABLE agent_sessions
ADD COLUMN message_revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_messages
ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER agent_messages_content_revision
AFTER UPDATE OF content ON agent_messages
WHEN NEW.content IS NOT OLD.content
 AND NEW.message_type = 'tool_call'
BEGIN
    UPDATE agent_sessions
    SET message_revision = message_revision + 1
    WHERE id = NEW.session_id;

    UPDATE agent_messages
    SET content_revision = (
        SELECT message_revision FROM agent_sessions WHERE id = NEW.session_id
    )
    WHERE id = NEW.id;
END;

CREATE INDEX idx_agent_messages_session_content_revision
ON agent_messages(session_id, content_revision)
WHERE content_revision > 0;
