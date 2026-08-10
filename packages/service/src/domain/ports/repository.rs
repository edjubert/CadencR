use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::error::AppError;

use super::attribution::FeatureDir;

/// Worktree directory of every feature that owns one outright, across all
/// projects — the scan is machine-wide, so it cannot be narrowed to one project.
///
/// A directory only identifies a feature when exactly one feature answers to
/// it, so anything shared is dropped rather than guessed at: features with no
/// worktree share their project root, reused worktrees are recorded against
/// several features, and a `worktree_path` equal to the project path is a
/// non-worktree feature in disguise. Those features are not lost — their
/// servers are attributed by terminal or agent ancestry instead, for as long as
/// that process lives.
pub async fn unambiguous_worktree_dirs(pool: &SqlitePool) -> Result<Vec<FeatureDir>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT fs.feature_id, TRIM(fs.value)
         FROM feature_settings fs
         JOIN features f ON f.id = fs.feature_id
         JOIN projects p ON p.id = f.project_id
         WHERE fs.key = 'worktree_path'
           AND TRIM(fs.value) <> ''
           AND TRIM(fs.value) <> TRIM(p.path)",
    )
    .fetch_all(pool)
    .await?;
    Ok(keep_unshared(rows))
}

/// Keep only the directories claimed by a single feature.
fn keep_unshared(rows: Vec<(i64, String)>) -> Vec<FeatureDir> {
    let mut claims: HashMap<String, Option<i64>> = HashMap::new();
    for (feature_id, path) in rows {
        claims
            .entry(path)
            .and_modify(|owner| {
                if *owner != Some(feature_id) {
                    *owner = None;
                }
            })
            .or_insert(Some(feature_id));
    }
    claims
        .into_iter()
        .filter_map(|(path, owner)| owner.map(|feature_id| FeatureDir { feature_id, path }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn a_directory_claimed_by_two_features_identifies_neither() {
        let dirs = keep_unshared(vec![
            (1, "/w/one".to_string()),
            (2, "/w/shared".to_string()),
            (3, "/w/shared".to_string()),
        ]);

        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].feature_id, 1);
    }

    #[tokio::test]
    async fn skips_blank_paths_and_the_project_root() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for ddl in [
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, path TEXT)",
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER)",
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT, PRIMARY KEY (feature_id, key))",
        ] {
            sqlx::query(ddl).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO projects (id, path) VALUES (1, '/repo')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO features (id, project_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES
                (1, 'worktree_path', '/w/one'),
                (2, 'worktree_path', '  '),
                (3, 'worktree_path', '/repo'),
                (4, 'branch', '/w/four')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let dirs = unambiguous_worktree_dirs(&pool).await.unwrap();

        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].feature_id, 1);
        assert_eq!(dirs[0].path, "/w/one");
    }
}
