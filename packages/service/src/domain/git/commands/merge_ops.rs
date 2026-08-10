//! `git merge-tree` / `git branch -d` orchestration.
//! Branch-resolution lives in [`super::merge`].

use std::path::Path;

use tokio::process::Command;

use crate::domain::git::models::{MergeConflictResult, MergeResult};
use crate::error::AppError;
use crate::shared::git_cli::run_git_safe_refs;

/// Check if merging source_branch into target_branch would produce conflicts.
///
/// Uses the modern two-argument form of `git merge-tree` (Git 2.38+) which
/// performs a real merge in-memory and exits with code 0 for clean merges or
/// code 1 for conflicts. The old three-argument form would false-positive on
/// identical changes present on both sides.
pub async fn check_merge_conflicts(
    repo_path: &Path,
    source_branch: &str,
    target_branch: &str,
) -> Result<MergeConflictResult, AppError> {
    // `git merge-tree --write-tree` performs an in-memory merge.
    // Exit 0 → clean merge, exit 1 → conflicts (listed on stdout).
    crate::shared::git_cli::guard_positionals(&[target_branch, source_branch])?;
    let output = Command::new("git")
        .args(["merge-tree", "--write-tree", target_branch, source_branch])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to run git merge-tree: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let exit_code = output.status.code().unwrap_or(-1);

    tracing::debug!(
        exit_code,
        stdout = %stdout.chars().take(500).collect::<String>(),
        "git merge-tree --write-tree {} {}",
        target_branch,
        source_branch,
    );

    if output.status.success() {
        // Clean merge — no conflicts
        return Ok(MergeConflictResult {
            has_conflicts: false,
            conflict_files: vec![],
        });
    }

    Ok(MergeConflictResult {
        has_conflicts: true,
        conflict_files: parse_conflict_files(&stdout),
    })
}

/// Pull conflicted paths out of git's "CONFLICT (...): Merge conflict in <path>"
/// lines, deduplicating in document order. Shared by the conflict-preview
/// (`check_merge_conflicts`) and real-merge (`workflow_service::merge_runner`)
/// codepaths so the two never drift.
pub fn parse_conflict_files(stdout: &str) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("CONFLICT") else {
            continue;
        };
        let Some(path) = rest.rsplit("Merge conflict in ").next() else {
            continue;
        };
        let path = path.trim();
        if path.is_empty() {
            continue;
        }
        if !seen.iter().any(|existing| existing == path) {
            seen.push(path.to_string());
        }
    }
    seen
}

/// Return true when `branch_name` is fully contained in `target_branch`.
pub async fn is_branch_merged(
    repo_path: &Path,
    branch_name: &str,
    target_branch: &str,
) -> Result<bool, AppError> {
    crate::shared::git_cli::guard_positionals(&[branch_name, target_branch])?;
    let output = Command::new("git")
        .args(["merge-base", "--is-ancestor", branch_name, target_branch])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::GitCommandError(format!("Failed to run git merge-base: {e}")))?;
    Ok(output.status.success())
}

/// Delete a local branch after the service layer has applied the target-branch
/// safety policy. `git branch -d` cannot enforce that policy: it checks the
/// branch's configured upstream (or the current `HEAD`) instead of the feature's
/// selected target branch.
pub async fn force_delete_branch(
    repo_path: &Path,
    branch_name: &str,
) -> Result<MergeResult, AppError> {
    match run_git_safe_refs(&["branch"], &["-D"], &[branch_name], repo_path).await {
        Ok(_) => Ok(MergeResult {
            success: true,
            error: None,
            conflict_files: None,
        }),
        Err(e) => Ok(MergeResult {
            success: false,
            error: Some(e.to_string()),
            conflict_files: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_conflict_files_in_document_order() {
        let stdout = "\
            Auto-merging foo.txt\n\
            CONFLICT (content): Merge conflict in foo.txt\n\
            Auto-merging dir/bar.rs\n\
            CONFLICT (add/add): Merge conflict in dir/bar.rs\n";
        assert_eq!(
            parse_conflict_files(stdout),
            vec!["foo.txt".to_string(), "dir/bar.rs".to_string()],
        );
    }

    #[test]
    fn parses_conflict_files_deduplicates_repeated_paths() {
        // Git can emit multiple CONFLICT lines for the same path (e.g.
        // `(content)` plus `(modify/delete)`). The shared parser must
        // dedup so consumers don't render the same file twice.
        let stdout = "\
            CONFLICT (content): Merge conflict in foo.txt\n\
            CONFLICT (modify/delete): Merge conflict in foo.txt\n";
        assert_eq!(parse_conflict_files(stdout), vec!["foo.txt".to_string()]);
    }

    #[test]
    fn parses_conflict_files_skips_unrelated_lines() {
        assert!(parse_conflict_files("Auto-merging foo.txt\n").is_empty());
        assert!(parse_conflict_files("").is_empty());
    }
}
