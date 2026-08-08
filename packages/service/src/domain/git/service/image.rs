use std::path::Path;

use crate::app_state::AppState;
use crate::domain::git::commands;
use crate::domain::git::models::{DiffImageSide, GetDiffImageParams};
use crate::error::AppError;
use crate::shared::image_file::{image_mime_for_path, MAX_IMAGE_FILE_SIZE};

use super::diff::resolve_diff_refs;
use super::resolve_feature_git_path;

pub struct DiffImage {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

fn image_source<'a>(
    params: &'a GetDiffImageParams,
    old_ref: &'a str,
    new_ref: Option<&'a str>,
) -> (&'a str, Option<&'a str>) {
    match params.side {
        DiffImageSide::Old => (
            params.old_file_path.as_deref().unwrap_or(&params.file_path),
            Some(old_ref),
        ),
        DiffImageSide::New => (params.file_path.as_str(), new_ref),
    }
}

/// Return one exact image side from the same ref pair used by the text diff.
pub async fn get_diff_image(
    state: &AppState,
    params: GetDiffImageParams,
) -> Result<DiffImage, AppError> {
    let git_path = resolve_feature_git_path(state, params.feature_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Feature worktree not found".into()))?;
    let root = Path::new(&git_path);
    let (old_ref, new_ref) = resolve_diff_refs(
        state,
        params.feature_id,
        &params.mode,
        params.target_branch.as_deref(),
        params.commit_sha.as_deref(),
        root,
    )
    .await?;

    let (file_path, reference) = image_source(&params, &old_ref, new_ref.as_deref());
    let mime = image_mime_for_path(Path::new(file_path))
        .ok_or_else(|| AppError::BadRequest("Unsupported image extension".into()))?;
    let bytes =
        match commands::get_file_bytes(root, file_path, reference, MAX_IMAGE_FILE_SIZE).await {
            Ok(bytes) => bytes,
            // Nothing to retry against: report why the image itself is missing.
            Err(error) => stashed_untracked_image(root, &params, file_path)
                .await?
                .ok_or(error)?,
        };

    Ok(DiffImage { bytes, mime })
}

/// An image swept into a stash by `--include-untracked` is absent from the
/// stash commit's own tree — it exists only in the stash's third parent — so
/// the new side has to be read from there. `None` when this isn't that case;
/// a retry that fails on its own terms (an oversized blob, say) reports its own
/// error rather than the caller's.
async fn stashed_untracked_image(
    root: &Path,
    params: &GetDiffImageParams,
    file_path: &str,
) -> Result<Option<Vec<u8>>, AppError> {
    if !matches!(params.side, DiffImageSide::New) {
        return Ok(None);
    }
    let Some(sha) = params.commit_sha.as_deref() else {
        return Ok(None);
    };
    let Some(parent) = commands::stash_untracked_parent(root, sha).await? else {
        return Ok(None);
    };
    commands::get_file_bytes(root, file_path, Some(&parent), MAX_IMAGE_FILE_SIZE)
        .await
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(side: DiffImageSide) -> GetDiffImageParams {
        GetDiffImageParams {
            feature_id: 1,
            file_path: "new/name.png".into(),
            old_file_path: Some("old/name.png".into()),
            side,
            mode: "uncommitted".into(),
            commit_sha: None,
            target_branch: None,
        }
    }

    #[test]
    fn old_side_uses_rename_source_and_base_ref() {
        assert_eq!(
            image_source(&params(DiffImageSide::Old), "base", Some("head")),
            ("old/name.png", Some("base"))
        );
    }

    #[test]
    fn new_side_uses_destination_and_comparison_ref() {
        assert_eq!(
            image_source(&params(DiffImageSide::New), "base", Some("head")),
            ("new/name.png", Some("head"))
        );
    }

    /// A PNG added and stashed with `-u` resolves from the stash's untracked
    /// parent; the old side of the same stash keeps its original error, since
    /// there is nothing to fall back to.
    #[tokio::test]
    async fn new_side_falls_back_to_the_stash_untracked_parent() {
        use crate::shared::git_cli::run_git;

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for args in [
            &["init", "-q", "-b", "main"][..],
            &["config", "user.email", "t@example.com"],
            &["config", "user.name", "T"],
            &["config", "commit.gpgsign", "false"],
        ] {
            run_git(args, root).await.unwrap();
        }
        tokio::fs::write(root.join("seed.txt"), "seed\n")
            .await
            .unwrap();
        run_git(&["add", "."], root).await.unwrap();
        run_git(&["commit", "-q", "-m", "base"], root)
            .await
            .unwrap();

        let png = b"\x89PNG\r\n\x1a\n\0stashed".to_vec();
        tokio::fs::write(root.join("logo.png"), &png).await.unwrap();
        run_git(&["stash", "push", "-u", "-q", "-m", "image"], root)
            .await
            .unwrap();
        let sha = run_git(&["rev-parse", "refs/stash"], root)
            .await
            .unwrap()
            .trim()
            .to_string();

        let stash_params = |side| GetDiffImageParams {
            feature_id: 1,
            file_path: "logo.png".into(),
            old_file_path: None,
            side,
            mode: "commit".into(),
            commit_sha: Some(sha.clone()),
            target_branch: None,
        };
        let bytes = stashed_untracked_image(root, &stash_params(DiffImageSide::New), "logo.png")
            .await
            .unwrap()
            .expect("new side resolves from the untracked parent");
        assert_eq!(bytes, png);

        let old_side = stashed_untracked_image(root, &stash_params(DiffImageSide::Old), "logo.png")
            .await
            .unwrap();
        assert_eq!(old_side, None, "the old side has nothing to fall back to");
    }
}
