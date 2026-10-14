use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::file_size::classify_content_bytes;
use crate::domain::git::models::*;
use crate::domain::git::repository;
use crate::error::AppError;

use super::resolve_feature_git_path;

pub async fn get_branch(
    state: &AppState,
    params: GetBranchParams,
) -> Result<BranchResponse, AppError> {
    let project_path = repository::get_project_path(&state.read_pool, params.project_id).await?;
    let branch = commands::get_current_branch(Path::new(&project_path)).await?;
    Ok(BranchResponse { branch })
}

pub async fn get_stats(state: &AppState, params: GetStatsParams) -> Result<GitStats, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(GitStats {
                files_changed: 0,
                insertions: 0,
                deletions: 0,
            })
        }
    };
    commands::get_stats(
        Path::new(&git_path),
        &params.mode,
        params.target_branch.as_deref(),
    )
    .await
}

pub async fn get_diff(state: &AppState, params: GetDiffParams) -> Result<DiffResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(DiffResponse {
                diff: String::new(),
            })
        }
    };

    let diff = if let Some(ref commit_sha) = params.commit_sha {
        commands::get_commit_diff(Path::new(&git_path), commit_sha).await?
    } else {
        commands::get_diff(
            Path::new(&git_path),
            &params.mode,
            params.target_branch.as_deref(),
        )
        .await?
    };
    Ok(DiffResponse { diff })
}

pub async fn get_changed_files(
    state: &AppState,
    params: GetChangedFilesParams,
) -> Result<Vec<ChangedFile>, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    commands::get_changed_files(
        Path::new(&git_path),
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
    )
    .await
}

/// Per-file unified diff. Backs the diff pane's lazy per-file fetch so opening
/// the Git tab on a large working tree no longer ships one multi-MB blob.
pub async fn get_file_diff(
    state: &AppState,
    params: GetFileDiffParams,
) -> Result<DiffResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(DiffResponse {
                diff: String::new(),
            })
        }
    };
    let diff = commands::get_file_diff(
        Path::new(&git_path),
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
        &params.file_path,
        params.old_file_path.as_deref(),
    )
    .await?;
    Ok(DiffResponse { diff })
}

/// Resolve which (old_ref, new_ref) pair the diff endpoints should use for a
/// given request. `None` for `new_ref` means "the working tree". Shared by
/// `get_file_content` and `get_file_content_batch` so both endpoints stay in
/// lock-step.
///
/// Priority for the comparison base in the "vs target" mode:
///
///   1. an explicit, non-empty `target_branch` from the caller — the user
///      picked it, we use it verbatim,
///   2. otherwise `workflow_service::resolve_target_branch` (consults the
///      stored feature setting, then the fallback chain pinned to
///      `origin/HEAD`),
///   3. otherwise the literal `"main"` last-resort label.
///
/// Bug fix: step 1 used to be silently overridden by `get_original_branch`,
/// which meant that an explicit pick from the picker (e.g. `origin/main`)
/// was discarded in favor of the original-branch fallback. The file-content
/// diff then used a different base than the stats endpoint and the user saw
/// inconsistent diffs.
pub(super) async fn resolve_diff_refs(
    state: &AppState,
    feature_id: i64,
    mode: &str,
    target_branch: Option<&str>,
    commit_sha: Option<&str>,
    path: &Path,
) -> Result<(String, Option<String>), AppError> {
    if let Some(sha) = commit_sha {
        return Ok((format!("{sha}^"), Some(sha.to_string())));
    }
    // `"uncommitted"` is an explicit alias for the working-tree-vs-HEAD diff;
    // the new Git tab segmented control persists this value, but the existing
    // `"worktree"` value remains supported for older clients.
    if mode == "worktree" || mode == "uncommitted" {
        return Ok(("HEAD".to_string(), None));
    }
    if let Some(explicit) = target_branch.and_then(|t| {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }) {
        return Ok((explicit, Some("HEAD".to_string())));
    }
    let base = crate::domain::git::workflow_service::resolve_target_branch(state, feature_id, path)
        .await
        .unwrap_or_else(|_| "main".to_string());
    Ok((base, Some("HEAD".to_string())))
}

/// Always returns the full content even for large text files — the
/// single-file endpoint is the explicit "user opted in" path. Binary
/// content is still suppressed (no useful textual diff to show).
pub async fn get_file_content(
    state: &AppState,
    params: GetFileContentParams,
) -> Result<FileContent, AppError> {
    crate::domain::git::workflow_service::validate_file_mutation_path(&params.file_path)?;
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(FileContent {
                old_content: None,
                new_content: None,
                old_size: 0,
                new_size: 0,
                is_binary: false,
                is_large: false,
            })
        }
    };
    let path = Path::new(&git_path);
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        params.feature_id,
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
        path,
    )
    .await?;

    if new_ref.is_none() {
        if let Ok(metadata) = tokio::fs::symlink_metadata(path.join(&params.file_path)).await {
            if !metadata.file_type().is_file() {
                return Err(AppError::BadRequest(
                    "Unsupported worktree file type cannot be opened as text".into(),
                ));
            }
        }
    }

    let (old_content, new_content) = tokio::join!(
        commands::get_file_bytes(path, &params.file_path, Some(&old_ref), usize::MAX),
        commands::get_file_bytes(path, &params.file_path, new_ref.as_deref(), usize::MAX),
    );
    // A missing Git-ref side is an addition/deletion. A missing worktree
    // Result stays an explicit error so the UI can offer deletion guidance.
    let old_content = old_content.unwrap_or_default();
    let (new_content, new_missing) = match (new_ref.is_some(), new_content) {
        (true, result) => (result.unwrap_or_default(), false),
        (false, Ok(content)) => (content, false),
        (false, Err(AppError::NotFound(_))) => (Vec::new(), true),
        (false, Err(error)) => return Err(error),
    };

    let mut content: FileContent = classify_content_bytes(
        params.file_path,
        old_content,
        new_content,
        /* keep_large_content */ true,
    )
    .into();
    if new_missing {
        content.new_content = None;
    }
    Ok(content)
}

pub async fn get_file_content_batch(
    state: &AppState,
    body: GetFileContentBatchBody,
) -> Result<Vec<FileContentBatchItem>, AppError> {
    let git_path = resolve_feature_git_path(state, body.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    if body.file_paths.is_empty() {
        return Ok(vec![]);
    }
    let path = Path::new(&git_path);
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        body.feature_id,
        &body.mode,
        body.target_branch.as_deref(),
        body.commit_sha.as_deref(),
        path,
    )
    .await?;

    commands::get_file_content_batch(path, &body.file_paths, &old_ref, new_ref.as_deref()).await
}

pub async fn get_commit_log(
    state: &AppState,
    params: GetCommitLogParams,
) -> Result<CommitLogResponse, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => {
            return Ok(CommitLogResponse {
                commits: vec![],
                is_on_base_branch: true,
            })
        }
    };
    let path = Path::new(&git_path);

    // The revision is only `HEAD` while the feature's own branch is the one
    // checked out here — a removed worktree or a moved project checkout would
    // otherwise list a different branch's commits under this feature.
    let scope = super::resolve_feature_scope(&state.read_pool, params.feature_id, path).await?;
    let Some(branch_name) = scope.branch else {
        return Ok(CommitLogResponse {
            commits: vec![],
            is_on_base_branch: true,
        });
    };

    // Use the same target-branch resolution as the status snapshot so the
    // commit-log view and the "ahead of target" badge are always counting
    // the same thing. Critical for the `main` (stale local) vs
    // `origin/main` (remote tip) divergence: if the user picked
    // `origin/main` as their target, both UIs must compare against
    // `origin/main`, not silently fall back to local `main` here.
    let base_branch =
        crate::domain::git::workflow_service::resolve_target_branch(state, params.feature_id, path)
            .await
            .unwrap_or_else(|_| "main".to_string());

    let head_rev = &scope.revision;

    if branch_name == base_branch {
        let commits = commands::get_recent_commits(path, params.limit, head_rev).await?;
        return Ok(CommitLogResponse {
            commits,
            is_on_base_branch: true,
        });
    }

    let commits = commands::get_commit_log(path, &base_branch, head_rev).await?;
    Ok(CommitLogResponse {
        commits,
        is_on_base_branch: false,
    })
}

pub async fn get_file_blob_shas(
    state: &AppState,
    params: GetFileBlobShasParams,
) -> Result<Vec<FileBlobSha>, AppError> {
    let wt_path = repository::get_feature_setting(
        &state.read_pool,
        params.feature_id,
        super::SETTING_WORKTREE_PATH,
    )
    .await?;
    let wt_path = match wt_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    if !crate::shared::git_context::has_git_metadata(Path::new(&wt_path)).await? {
        return Ok(vec![]);
    }
    let map = commands::get_file_blob_shas(Path::new(&wt_path)).await?;
    Ok(map
        .into_iter()
        .map(|(file_path, sha)| FileBlobSha { file_path, sha })
        .collect())
}

pub async fn list_files(
    state: &AppState,
    params: ListFilesParams,
) -> Result<Vec<String>, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id).await?;
    let git_path = match git_path {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    commands::list_files(Path::new(&git_path)).await
}

#[cfg(test)]
mod tests {
    use super::super::test_support::setup_diff_refs_schema;
    use super::super::SETTING_WORKTREE_BRANCH;
    use super::*;

    /// An explicit `target_branch` from the caller must win over any fallback.
    /// Regression test for the bug where the original-branch fallback silently
    /// overrode the user's explicit pick.
    #[tokio::test]
    async fn resolve_diff_refs_honors_explicit_target_branch() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        // Configure a worktree branch *and* a different stored target so we
        // can prove the explicit param is what wins, not either of those.
        repository::set_feature_setting(&pool, 1, SETTING_WORKTREE_BRANCH, "feature/x")
            .await
            .unwrap();
        repository::set_feature_setting(&pool, 1, "target_branch", "develop")
            .await
            .unwrap();

        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        let (old_ref, new_ref) =
            resolve_diff_refs(&state, 1, "target", Some("origin/main"), None, dir.path())
                .await
                .unwrap();
        assert_eq!(old_ref, "origin/main");
        assert_eq!(new_ref.as_deref(), Some("HEAD"));
    }

    /// Blank/whitespace `target_branch` from the caller must NOT short-circuit
    /// the resolver — fall through to `resolve_target_branch`, which will use
    /// the stored setting.
    #[tokio::test]
    async fn resolve_diff_refs_blank_explicit_target_falls_through_to_setting() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        repository::set_feature_setting(&pool, 1, "target_branch", "develop")
            .await
            .unwrap();

        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        let (old_ref, new_ref) =
            resolve_diff_refs(&state, 1, "target", Some("   "), None, dir.path())
                .await
                .unwrap();
        assert_eq!(old_ref, "develop");
        assert_eq!(new_ref.as_deref(), Some("HEAD"));
    }

    /// `mode == "uncommitted"` always means working-tree-vs-HEAD regardless
    /// of any target-branch arg. Both `"worktree"` and `"uncommitted"` must
    /// behave the same.
    #[tokio::test]
    async fn resolve_diff_refs_uncommitted_mode_uses_head_vs_worktree() {
        let pool = setup_diff_refs_schema().await;
        sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'feat')")
            .execute(&pool)
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let dir = tempfile::tempdir().unwrap();

        for mode in ["worktree", "uncommitted"] {
            let (old_ref, new_ref) =
                resolve_diff_refs(&state, 1, mode, Some("origin/main"), None, dir.path())
                    .await
                    .unwrap();
            assert_eq!(old_ref, "HEAD", "mode={mode} must compare against HEAD");
            assert!(
                new_ref.is_none(),
                "mode={mode} must compare against working tree (None)"
            );
        }
    }
}
