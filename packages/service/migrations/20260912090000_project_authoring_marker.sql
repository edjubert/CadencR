-- Plugin author projects remain ordinary user projects. These nullable fields
-- record which locally-authored plugin they own without changing existing rows.
ALTER TABLE projects ADD COLUMN authoring_target TEXT
    CHECK (authoring_target IN ('theme', 'provider'));
ALTER TABLE projects ADD COLUMN plugin_id TEXT
    CHECK ((authoring_target IS NULL) = (plugin_id IS NULL));

CREATE UNIQUE INDEX projects_authoring_identity
    ON projects (authoring_target, plugin_id)
    WHERE authoring_target IS NOT NULL;
