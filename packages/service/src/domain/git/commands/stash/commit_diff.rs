//! The stash shape the generic commit-diff pipeline has to know about.
//!
//! A stash is a *merge* commit: parent 1 is the base commit, parent 2 the index
//! commit, and — only for `git stash push --include-untracked` — parent 3 a root
//! commit whose tree is exactly the untracked files that were swept in.
//!
//! Both halves used to come up empty. `git diff-tree <sha>` prints nothing at
//! all for a merge commit unless told which parent to diff against (see
//! [`FIRST_PARENT_MERGES`](super::super::util::FIRST_PARENT_MERGES)), so every
//! stash listed zero changed files; and the untracked parent is unreachable
//! from the stash commit's own tree, so a stash whose contents were all new
//! files had nothing to show even once the merge was handled.
//!
//! [`untracked_parent`] deliberately checks the stash reflog rather than
//! trusting the parent count: a plain octopus merge also has three parents, and
//! folding its third parent's *entire tree* into a diff as additions would be
//! nonsense.

use std::path::Path;

use crate::error::AppError;
use crate::shared::git_cli::run_git_background;

/// The commit holding the untracked files of `sha`, when `sha` is a stash
/// created with `--include-untracked`. `None` for every other commit.
///
/// `sha` is matched against `%H`, so it has to be a full SHA — the form every
/// caller already has, from either the commit graph or [`super::list_stashes`].
pub(crate) async fn untracked_parent(
    repo_path: &Path,
    sha: &str,
) -> Result<Option<String>, AppError> {
    let stdout = run_git_background(&["stash", "list", "--format=%H %P"], repo_path).await?;
    Ok(parse_untracked_parent(&stdout, sha))
}

/// Pick `sha`'s untracked parent out of `git stash list --format=%H %P` output.
/// A commit that isn't in the list at all yields `None`.
fn parse_untracked_parent(stash_list: &str, sha: &str) -> Option<String> {
    stash_list.lines().find_map(|line| {
        let (listed, parents) = line.split_once(' ')?;
        if listed != sha {
            return None;
        }
        untracked_parent_of(parents)
    })
}

/// The untracked parent within a stash commit's `%P` parent list: present only
/// when there are exactly three, since a `--include-untracked` stash is the one
/// stash shape that carries a third parent.
pub(super) fn untracked_parent_of(parents: &str) -> Option<String> {
    match *parents.split_whitespace().collect::<Vec<_>>() {
        [_base, _index, untracked] => Some(untracked.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::git_cli::run_git;

    const LIST: &str = "aaa111 base111 index111 untracked111\nbbb222 base222 index222\n";

    #[test]
    fn untracked_stash_resolves_to_its_third_parent() {
        assert_eq!(
            parse_untracked_parent(LIST, "aaa111"),
            Some("untracked111".to_string())
        );
    }

    #[test]
    fn stash_without_untracked_parent_has_none() {
        assert_eq!(parse_untracked_parent(LIST, "bbb222"), None);
    }

    #[test]
    fn commit_outside_the_stash_list_has_none() {
        assert_eq!(parse_untracked_parent(LIST, "ccc333"), None);
        assert_eq!(parse_untracked_parent("", "aaa111"), None);
    }

    /// Only a three-parent list is a `-u` stash; anything else — an ordinary
    /// commit, a two-parent stash, an octopus merge — has no untracked half.
    #[test]
    fn only_exactly_three_parents_yield_an_untracked_parent() {
        assert_eq!(untracked_parent_of("a b c"), Some("c".to_string()));
        assert_eq!(untracked_parent_of("a b c d"), None);
        assert_eq!(untracked_parent_of("a b"), None);
        assert_eq!(untracked_parent_of(""), None);
    }

    /// Against real git: only the `-u` stash resolves a third parent, and a
    /// regular commit — even one with the same shape of history — never does.
    #[tokio::test]
    async fn untracked_parent_matches_only_include_untracked_stashes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        for args in [
            &["init", "-q", "-b", "main"][..],
            &["config", "user.email", "t@example.com"],
            &["config", "user.name", "T"],
            &["config", "commit.gpgsign", "false"],
        ] {
            run_git(args, path).await.unwrap();
        }
        tokio::fs::write(path.join("a.txt"), "base\n")
            .await
            .unwrap();
        run_git(&["add", "."], path).await.unwrap();
        run_git(&["commit", "-q", "-m", "base"], path)
            .await
            .unwrap();
        let head = run_git(&["rev-parse", "HEAD"], path).await.unwrap();

        tokio::fs::write(path.join("a.txt"), "edited\n")
            .await
            .unwrap();
        run_git(&["stash", "push", "-q", "-m", "tracked"], path)
            .await
            .unwrap();
        tokio::fs::write(path.join("new.txt"), "new\n")
            .await
            .unwrap();
        run_git(&["stash", "push", "-u", "-q", "-m", "untracked"], path)
            .await
            .unwrap();

        let with_untracked = run_git(&["rev-parse", "stash@{0}"], path).await.unwrap();
        let without_untracked = run_git(&["rev-parse", "stash@{1}"], path).await.unwrap();

        let resolved = untracked_parent(path, with_untracked.trim())
            .await
            .unwrap()
            .expect("stash pushed with -u has an untracked parent");
        let listed = run_git(&["ls-tree", "-r", "--name-only", &resolved], path)
            .await
            .unwrap();
        assert_eq!(listed.trim(), "new.txt");

        assert_eq!(
            untracked_parent(path, without_untracked.trim())
                .await
                .unwrap(),
            None
        );
        assert_eq!(untracked_parent(path, head.trim()).await.unwrap(), None);
    }
}
