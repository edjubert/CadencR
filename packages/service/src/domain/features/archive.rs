use sqlx::{QueryBuilder, Sqlite, SqlitePool, Transaction};

use super::models::{ArchivePreview, ArchiveRequest, ArchiveResponse};
use crate::error::AppError;

mod graph;
use graph::load_graph;

pub async fn preview(pool: &SqlitePool, selected_id: i64) -> Result<ArchivePreview, AppError> {
    let mut connection = pool.acquire().await?;
    Ok(load_graph(&mut connection, selected_id)
        .await?
        .preview(selected_id))
}

pub async fn archive(
    pool: &SqlitePool,
    selected_id: i64,
    request: ArchiveRequest,
) -> Result<ArchiveResponse, AppError> {
    let mut tx = pool.begin().await?;
    let mut ids = vec![selected_id];
    if request.include_parent || request.include_descendants {
        let preview = load_graph(&mut tx, selected_id).await?.preview(selected_id);
        if request.include_parent {
            ids.extend(preview.parent_ids);
        }
        if request.include_descendants {
            ids.extend(preview.descendant_ids);
        }
    }
    ids.sort_unstable();
    ids.dedup();
    archive_ids(&mut tx, &ids).await?;
    tx.commit().await?;
    Ok(ArchiveResponse { archived_ids: ids })
}

async fn archive_ids(tx: &mut Transaction<'_, Sqlite>, ids: &[i64]) -> Result<(), AppError> {
    // Keep each statement below SQLite's conservative bind-parameter limit.
    for chunk in ids.chunks(500) {
        let mut query = QueryBuilder::<Sqlite>::new(
            "UPDATE features SET status = 'archived', \
             archived_at = COALESCE(archived_at, datetime('now')) WHERE id IN (",
        );
        let mut separated = query.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
        let result = query.build().execute(&mut **tx).await?;
        if result.rows_affected() != chunk.len() as u64 {
            return Err(AppError::NotFound(
                "An archive target no longer exists".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (SqlitePool, i64, i64) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        let first = add_project(&pool, "first").await;
        let second = add_project(&pool, "second").await;
        (pool, first, second)
    }

    async fn add_project(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query_scalar("INSERT INTO projects (name, path) VALUES (?, ?) RETURNING id")
            .bind(name)
            .bind(format!("/tmp/{name}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn add_feature(pool: &SqlitePool, project: i64, status: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO features (project_id, title, status) VALUES (?, 'f', ?) RETURNING id",
        )
        .bind(project)
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn link(pool: &SqlitePool, parent: i64, child: i64, kind: &str, created: &str) {
        let source: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) \
             VALUES (?, 'session', 'paused') RETURNING id",
        )
        .bind(parent)
        .fetch_one(pool)
        .await
        .unwrap();
        let target: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) \
             VALUES (?, 'session', 'paused') RETURNING id",
        )
        .bind(child)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_session_links \
             (source_session_id, target_session_id, link_type, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(source)
        .bind(target)
        .bind(kind)
        .bind(created)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn statuses(pool: &SqlitePool, ids: &[i64]) -> Vec<String> {
        let mut values = Vec::new();
        for id in ids {
            values.push(
                sqlx::query_scalar("SELECT status FROM features WHERE id = ?")
                    .bind(id)
                    .fetch_one(pool)
                    .await
                    .unwrap(),
            );
        }
        values
    }

    #[tokio::test]
    async fn single_archive_does_not_read_the_relationship_graph() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE features (id INTEGER PRIMARY KEY, status TEXT, archived_at TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO features (id, status) VALUES (1, 'active')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            archive(&pool, 1, ArchiveRequest::default())
                .await
                .unwrap()
                .archived_ids,
            vec![1]
        );
        assert!(matches!(
            archive(&pool, 2, ArchiveRequest::default()).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn archive_batches_large_trees_and_rolls_back_all_chunks_on_failure() {
        let (pool, project, _) = setup().await;
        let root = add_feature(&pool, project, "active").await;
        let children: Vec<i64> = sqlx::query_scalar(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < 1001) \
             INSERT INTO features (project_id, title, status) SELECT ?, 'bulk ' || x, 'active' FROM n RETURNING id",
        ).bind(project).fetch_all(&pool).await.unwrap();
        sqlx::query("INSERT INTO agent_sessions (feature_id, agent_type, status) SELECT id, 'session', 'paused' FROM features WHERE project_id = ?")
            .bind(project).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO agent_session_links (source_session_id, target_session_id, link_type) SELECT source.id, target.id, 'spawned' FROM agent_sessions source JOIN agent_sessions target ON target.feature_id != source.feature_id JOIN features f ON f.id = target.feature_id WHERE source.feature_id = ? AND f.project_id = ?")
            .bind(root).bind(project).execute(&pool).await.unwrap();
        let last = children.last().unwrap();
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER reject_last BEFORE UPDATE ON features WHEN NEW.id = {last} BEGIN SELECT RAISE(ABORT, 'blocked'); END"
        ))).execute(&pool).await.unwrap();
        let request = || ArchiveRequest {
            include_parent: false,
            include_descendants: true,
        };
        assert!(archive(&pool, root, request()).await.is_err());
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM features WHERE project_id = ? AND status = 'active'",
        )
        .bind(project)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active, 1002);
        sqlx::query("DROP TRIGGER reject_last")
            .execute(&pool)
            .await
            .unwrap();
        let response = archive(&pool, root, request()).await.unwrap();
        let mut expected = vec![root];
        expected.extend(children);
        assert_eq!(response.archived_ids, expected);
        let archived: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM features WHERE project_id = ? AND status = 'archived'",
        )
        .bind(project)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(archived, 1002);
    }

    #[tokio::test]
    async fn archive_supports_all_four_selection_combinations() {
        for (include_parent, include_descendants) in
            [(false, false), (true, false), (false, true), (true, true)]
        {
            let (pool, project, _) = setup().await;
            let grandparent = add_feature(&pool, project, "active").await;
            let parent = add_feature(&pool, project, "active").await;
            let selected = add_feature(&pool, project, "active").await;
            let child = add_feature(&pool, project, "active").await;
            let sibling = add_feature(&pool, project, "active").await;
            link(&pool, grandparent, parent, "spawned", "2025-12-31").await;
            link(&pool, parent, selected, "spawned", "2026-01-01").await;
            link(&pool, selected, child, "handoff", "2026-01-02").await;
            link(&pool, parent, sibling, "spawned", "2026-01-03").await;
            let response = archive(
                &pool,
                selected,
                ArchiveRequest {
                    include_parent,
                    include_descendants,
                },
            )
            .await
            .unwrap();
            let mut expected = vec![selected];
            if include_parent {
                expected.push(parent);
            }
            if include_descendants {
                expected.push(child);
            }
            expected.sort_unstable();
            assert_eq!(response.archived_ids, expected);
            let actual = statuses(&pool, &[grandparent, parent, selected, child, sibling]).await;
            assert_eq!(actual[0], "active");
            assert_eq!(
                actual[1],
                if include_parent { "archived" } else { "active" }
            );
            assert_eq!(actual[2], "archived");
            assert_eq!(
                actual[3],
                if include_descendants {
                    "archived"
                } else {
                    "active"
                }
            );
            assert_eq!(actual[4], "active");
        }
    }

    #[tokio::test]
    async fn self_link_is_not_an_eligible_relation() {
        let (pool, project, _) = setup().await;
        let selected = add_feature(&pool, project, "active").await;
        link(&pool, selected, selected, "spawned", "2026-01-01").await;
        let result = preview(&pool, selected).await.unwrap();
        assert_eq!(result.parent_ids, Vec::<i64>::new());
        assert_eq!(result.descendant_ids, Vec::<i64>::new());
        assert!(!result.has_relations);
    }

    #[tokio::test]
    async fn preview_crosses_archived_bridges_and_deep_graphs() {
        let (pool, project, _) = setup().await;
        let root = add_feature(&pool, project, "active").await;
        let bridge = add_feature(&pool, project, "archived").await;
        let leaf = add_feature(&pool, project, "active").await;
        let deep = add_feature(&pool, project, "active").await;
        link(&pool, root, bridge, "spawned", "2026-01-01").await;
        link(&pool, bridge, leaf, "spawned", "2026-01-02").await;
        link(&pool, leaf, deep, "spawned", "2026-01-03").await;
        let result = preview(&pool, root).await.unwrap();
        assert_eq!(result.descendant_ids, vec![leaf, deep]);
        assert!(result.has_relations);
    }

    #[tokio::test]
    async fn canonical_parent_is_earliest_and_graph_is_project_scoped() {
        let (pool, project, other_project) = setup().await;
        let earliest = add_feature(&pool, project, "active").await;
        let later = add_feature(&pool, project, "active").await;
        let selected = add_feature(&pool, project, "active").await;
        let cross = add_feature(&pool, other_project, "active").await;
        link(&pool, later, selected, "spawned", "2026-01-02").await;
        link(&pool, earliest, selected, "handoff", "2026-01-01").await;
        link(&pool, selected, cross, "spawned", "2026-01-03").await;
        let result = preview(&pool, selected).await.unwrap();
        assert_eq!(result.parent_ids, vec![earliest]);
        assert!(!result.descendant_ids.contains(&cross));
    }

    #[tokio::test]
    async fn cyclic_ancestry_detaches_ancestors_and_their_other_children() {
        let (pool, project, _) = setup().await;
        let ancestor = add_feature(&pool, project, "active").await;
        let parent = add_feature(&pool, project, "active").await;
        let selected = add_feature(&pool, project, "active").await;
        let sibling = add_feature(&pool, project, "active").await;
        link(&pool, ancestor, parent, "spawned", "2026-01-01").await;
        link(&pool, parent, selected, "spawned", "2026-01-02").await;
        link(&pool, selected, ancestor, "spawned", "2026-01-03").await;
        link(&pool, parent, sibling, "spawned", "2026-01-04").await;
        let result = preview(&pool, selected).await.unwrap();
        assert!(result.parent_ids.is_empty());
        assert!(result.descendant_ids.is_empty());
        assert!(!result.has_relations);
    }

    #[tokio::test]
    async fn archive_is_atomic_and_preserves_existing_archived_at() {
        let (pool, project, _) = setup().await;
        let selected = add_feature(&pool, project, "active").await;
        let child = add_feature(&pool, project, "active").await;
        link(&pool, selected, child, "spawned", "2026-01-01").await;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER reject_archive BEFORE UPDATE ON features \
             WHEN NEW.id = {child} AND NEW.status = 'archived' BEGIN SELECT RAISE(ABORT, 'no'); END"
        )))
        .execute(&pool)
        .await
        .unwrap();
        assert!(archive(
            &pool,
            selected,
            ArchiveRequest {
                include_parent: false,
                include_descendants: true
            },
        )
        .await
        .is_err());
        assert_eq!(
            statuses(&pool, &[selected, child]).await,
            vec!["active", "active"]
        );
        sqlx::query("DROP TRIGGER reject_archive")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE features SET status = 'archived', archived_at = '2020-01-01' WHERE id = ?",
        )
        .bind(child)
        .execute(&pool)
        .await
        .unwrap();
        archive(&pool, child, ArchiveRequest::default())
            .await
            .unwrap();
        let archived_at: String =
            sqlx::query_scalar("SELECT archived_at FROM features WHERE id = ?")
                .bind(child)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(archived_at, "2020-01-01");
    }
}
