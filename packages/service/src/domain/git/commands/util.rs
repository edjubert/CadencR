//! Internal helpers shared across the `commands/*` submodules.

use std::path::Path;

use crate::shared::git_cli::run_git_background;

/// Makes `diff-tree` and `log` describe a merge commit by its first-parent
/// diff instead of their default (no output whatsoever). Without it a merge —
/// and every stash is one — reports itself as changing nothing. Harmless on
/// non-merge and root commits.
pub(super) const FIRST_PARENT_MERGES: &str = "--diff-merges=first-parent";

/// Run a git command, returning Ok("") instead of Err on failure.
pub(super) async fn run_git_quiet(args: &[&str], cwd: &Path) -> String {
    run_git_background(args, cwd).await.unwrap_or_default()
}
