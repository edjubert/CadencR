use std::path::{Path, PathBuf};

use axum::http::StatusCode;

use crate::domain::agents::providers::installed::installation::is_executable_file;
use crate::domain::git::worktree_context::resolve_source_git_root;
use crate::error::AppError;

pub(super) async fn validate_directory(
    value: &str,
    binary_name: &str,
) -> Result<PathBuf, AppError> {
    let supplied = Path::new(value);
    if !supplied.is_absolute() {
        return Err(invalid_directory(
            "provider directory must be an absolute path",
        ));
    }
    let directory = std::fs::canonicalize(supplied).map_err(|error| {
        invalid_directory(format!("provider directory could not be resolved: {error}"))
    })?;
    if !directory.is_dir() {
        return Err(invalid_directory(
            "provider directory must identify an existing directory",
        ));
    }
    validate_repository_root(&directory).await?;
    validate_executable(&directory.join("bin").join(binary_name))?;
    Ok(directory)
}

async fn validate_repository_root(directory: &Path) -> Result<(), AppError> {
    let root = resolve_source_git_root(directory).await.map_err(|error| {
        AppError::coded(
            StatusCode::BAD_REQUEST,
            "INVALID_PROVIDER_REPOSITORY",
            format!("provider directory must be an existing Git repository: {error}"),
        )
    })?;
    if root != directory {
        return Err(AppError::coded(
            StatusCode::BAD_REQUEST,
            "INVALID_PROVIDER_REPOSITORY",
            "provider directory must be the root of its Git repository",
        ));
    }
    Ok(())
}

fn validate_executable(executable: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(executable).map_err(|error| {
        AppError::coded(
            StatusCode::BAD_REQUEST,
            "INVALID_PROVIDER_EXECUTABLE",
            format!(
                "provider connector could not be read at {}: {error}",
                executable.display()
            ),
        )
    })?;
    if !is_executable_file(&metadata) {
        return Err(invalid_executable(format!(
            "provider connector is not an executable file: {}",
            executable.display()
        )));
    }
    Ok(())
}

fn invalid_directory(message: impl Into<String>) -> AppError {
    AppError::coded(
        StatusCode::BAD_REQUEST,
        "INVALID_PROVIDER_DIRECTORY",
        message,
    )
}

fn invalid_executable(message: impl Into<String>) -> AppError {
    AppError::coded(
        StatusCode::BAD_REQUEST,
        "INVALID_PROVIDER_EXECUTABLE",
        message,
    )
}

#[cfg(test)]
mod tests {
    use super::{validate_directory, validate_executable};
    use crate::shared::git_cli::run_git;
    use tempfile::TempDir;

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[tokio::test]
    async fn rejects_a_file_and_a_nested_repository_directory() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("file");
        std::fs::write(&file, "not a directory").unwrap();
        assert_code(
            validate_directory(file.to_str().unwrap(), "provider")
                .await
                .unwrap_err(),
            "INVALID_PROVIDER_DIRECTORY",
        );

        let root = repository(&temp).await;
        let nested = root.join("nested");
        std::fs::create_dir(&nested).unwrap();
        assert_code(
            validate_directory(nested.to_str().unwrap(), "provider")
                .await
                .unwrap_err(),
            "INVALID_PROVIDER_REPOSITORY",
        );
    }

    #[test]
    fn rejects_a_non_regular_executable() {
        let temp = TempDir::new().unwrap();
        let executable = temp.path().join("provider");
        std::fs::create_dir(&executable).unwrap();
        assert_code(
            validate_executable(&executable).unwrap_err(),
            "INVALID_PROVIDER_EXECUTABLE",
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resolves_a_symlink_alias_to_the_canonical_repository_root() {
        let temp = TempDir::new().unwrap();
        let root = repository(&temp).await;
        install_executable(&root);
        let alias = temp.path().join("alias");
        symlink(&root, &alias).unwrap();

        let validated = validate_directory(alias.to_str().unwrap(), "provider")
            .await
            .unwrap();
        assert_eq!(validated, root);
    }

    async fn repository(temp: &TempDir) -> std::path::PathBuf {
        let root = temp.path().join("repository");
        std::fs::create_dir(&root).unwrap();
        run_git(&["init", "-q", "-b", "main"], &root).await.unwrap();
        std::fs::canonicalize(root).unwrap()
    }

    #[cfg(unix)]
    fn install_executable(root: &std::path::Path) {
        let executable = root.join("bin/provider");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "connector").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn assert_code(error: crate::error::AppError, expected: &str) {
        match error {
            crate::error::AppError::Coded { code, .. } => assert_eq!(code, expected),
            other => panic!("expected coded error {expected}, got {other:?}"),
        }
    }
}
