/// Share the source worktree verbatim. Provisioning then short-circuits on the
/// existing path instead of attempting a second `git worktree add`.
///
/// `feature_branch` travels with it for the same reason `worktree_branch` does:
/// a fork works on the source's branch rather than getting its own, so without
/// it a forked worktree-free feature falls back to whatever the shared project
/// checkout has on HEAD.
pub(super) async fn copy_worktree_settings(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    new_feature_id: i64,
    source_feature_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) \
         SELECT ?, key, value FROM feature_settings \
         WHERE feature_id = ? \
         AND (key LIKE 'worktree%' OR key = 'skip_worktree' OR key = ?)",
    )
    .bind(new_feature_id)
    .bind(source_feature_id)
    .bind(crate::domain::git::service::SETTING_FEATURE_BRANCH)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Mark the forked conversation's first message as session-generated from the
/// source feature, so the existing provenance badge renders "forked from …".
/// No-op when the fork keeps nothing (forking at the first message).
pub(super) async fn record_fork_lineage(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    new_session_id: i64,
    source_session_id: i64,
    source_feature_id: i64,
    source_message_id: i64,
) -> Result<(), sqlx::Error> {
    let first_message_id: Option<i64> =
        sqlx::query_scalar("SELECT MIN(id) FROM agent_messages WHERE session_id = ?")
            .bind(new_session_id)
            .fetch_one(&mut **tx)
            .await?;
    let Some(first_message_id) = first_message_id else {
        return Ok(());
    };

    sqlx::query(
        "INSERT INTO agent_message_origins \
            (message_id, origin_kind, source_session_id, source_feature_id, source_message_id, note) \
         VALUES (?, 'session_generated', ?, ?, ?, 'Forked conversation') \
         ON CONFLICT(message_id) DO NOTHING",
    )
    .bind(first_message_id)
    .bind(source_session_id)
    .bind(source_feature_id)
    .bind(source_message_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
