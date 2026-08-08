use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nvim_rs::Value;
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::error::AppError;

use super::protocol::NeovimStartResponse;

#[allow(dead_code)]
pub struct NeovimApiInfo {
    pub version: String,
}

#[allow(dead_code)]
struct NeovimHandle {
    feature_id: i64,
    api_info: NeovimApiInfo,
    child: Arc<Mutex<Child>>,
    nvim: nvim_rs::Neovim<tokio_util::compat::Compat<tokio::process::ChildStdin>>,
    buffers: HashMap<String, i64>,
}

pub struct NeovimManager {
    processes: Arc<Mutex<HashMap<i64, NeovimHandle>>>,
}

#[allow(dead_code)]
impl NeovimManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, feature_id: i64) -> Result<NeovimStartResponse, AppError> {
        let mut processes = self.processes.lock().await;
        if let Some(existing) = processes.get(&feature_id) {
            return Ok(NeovimStartResponse {
                version: existing.api_info.version.clone(),
            });
        }

        let mut cmd = build_nvim_command();

        let (nvim, _io_handle, child) =
            nvim_rs::create::tokio::new_child_cmd(&mut cmd, DefaultHandler::new())
                .await
                .map_err(|e| AppError::NeovimSpawnError {
                    detail: e.to_string(),
                })?;

        let api_info_result =
            tokio::time::timeout(std::time::Duration::from_secs(5), nvim.get_api_info())
                .await
                .map_err(|_| AppError::NeovimHandshakeTimeout)?
                .map_err(|e| AppError::NeovimSpawnError {
                    detail: e.to_string(),
                })?;

        let version = extract_version(&api_info_result);
        let child = Arc::new(Mutex::new(child));

        let handle = NeovimHandle {
            feature_id,
            api_info: NeovimApiInfo {
                version: version.clone(),
            },
            child: child.clone(),
            nvim,
            buffers: HashMap::new(),
        };
        processes.insert(feature_id, handle);
        drop(processes);

        let processes_for_waiter = self.processes.clone();
        let child_for_waiter = child.clone();
        let feature_id_for_waiter = feature_id;
        tokio::spawn(async move {
            let _ = child_for_waiter.lock().await.wait().await;
            let mut processes = processes_for_waiter.lock().await;
            if processes
                .get(&feature_id_for_waiter)
                .is_some_and(|handle| Arc::ptr_eq(&handle.child, &child_for_waiter))
            {
                processes.remove(&feature_id_for_waiter);
            }
        });

        Ok(NeovimStartResponse { version })
    }

    pub async fn stop(&self, feature_id: i64) -> Result<(), AppError> {
        let mut processes = self.processes.lock().await;
        match processes.remove(&feature_id) {
            Some(handle) => {
                drop(processes);
                let _ = handle.child.lock().await.kill().await;
                Ok(())
            }
            None => Err(AppError::NeovimNotRunning {
                feature_id: feature_id.to_string(),
            }),
        }
    }

    pub(crate) async fn is_running(&self, feature_id: i64) -> bool {
        self.processes.lock().await.contains_key(&feature_id)
    }

    #[allow(dead_code)]
    pub async fn push_buffer(
        &self,
        feature_id: i64,
        file_path: &str,
        content: &str,
    ) -> Result<(), AppError> {
        let _absolute_path = Self::build_contained_worktree_path_for_file(
            &Self::resolve_worktree_root(feature_id)?,
            file_path,
        )?;

        let mut processes = self.processes.lock().await;
        let handle = processes.get_mut(&feature_id).ok_or(AppError::NeovimProcessNotRunning)?;

        let bufnr = match handle.buffers.get(file_path) {
            Some(&bufnr) => bufnr,
            None => {
                handle
                    .nvim
                    .command("new")
                    .await
                    .map_err(|e| AppError::NeovimSpawnError {
                        detail: e.to_string(),
                    })?;

                handle
                    .nvim
                    .command("setlocal noswapfile")
                    .await
                    .map_err(|e| AppError::NeovimSpawnError {
                        detail: e.to_string(),
                    })?;

                let bufnr = handle
                    .nvim
                    .eval("bufnr('%')")
                    .await
                    .map_err(|e| AppError::NeovimSpawnError {
                        detail: e.to_string(),
                    })?;
                let bufnr: i64 = bufnr.as_i64().ok_or_else(|| AppError::NeovimSpawnError {
                    detail: "unexpected response from bufnr('%')".to_string(),
                })?;

                handle.buffers.insert(file_path.to_string(), bufnr);
                bufnr
            }
        };

        let lines: Vec<String> = content.split('\n').map(String::from).collect();
        let buffer = nvim_rs::Buffer::new(nvim_rs::Value::Integer(bufnr.into()), handle.nvim.clone());
        buffer
            .set_lines(0, -1, false, lines)
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        Ok(())
    }

    pub async fn pull_buffer(
        &self,
        feature_id: i64,
        file_path: &str,
    ) -> Result<String, AppError> {
        let mut processes = self.processes.lock().await;
        let handle = processes.get_mut(&feature_id).ok_or(AppError::NeovimProcessNotRunning)?;

        let &bufnr = handle
            .buffers
            .get(file_path)
            .ok_or_else(|| AppError::NeovimBufferNotFound {
                file_path: file_path.to_string(),
            })?;

        let buffer =
            nvim_rs::Buffer::new(nvim_rs::Value::Integer(bufnr.into()), handle.nvim.clone());
        let lines: Vec<String> = buffer
            .get_lines(0, -1, false)
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        Ok(lines.join("\n"))
    }

    fn resolve_worktree_root(_feature_id: i64) -> Result<PathBuf, AppError> {
        let home = dirs::home_dir().ok_or(AppError::Internal(
            "Could not determine home directory".to_string(),
        ))?;
        Ok(home.join(".cadencr").join("worktrees"))
    }

    fn build_contained_worktree_path_for_file(
        root: &Path,
        file_path: &str,
    ) -> Result<PathBuf, AppError> {
        let file_path = Path::new(file_path);
        let absolute = if file_path.is_absolute() {
            file_path.to_path_buf()
        } else {
            root.join(file_path)
        };

        let canon = match absolute.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                let parent = absolute.parent().map(Path::to_path_buf);
                match parent {
                    Some(p) => match p.canonicalize() {
                        Ok(canon_parent) => {
                            let file_name = absolute.file_name().map(|n| n.to_os_string());
                            match file_name {
                                Some(name) => canon_parent.join(name),
                                None => {
                                    return Err(AppError::Internal(
                                        "File path has no valid name component".to_string(),
                                    ))
                                }
                            }
                        }
                        Err(_) => absolute,
                    },
                    None => absolute,
                }
            }
        };

        let canon_root = root.canonicalize().map_err(|e| AppError::Internal(
            format!("Failed to canonicalize worktree root: {e}"),
        ))?;

        if !canon.starts_with(&canon_root) {
            return Err(AppError::BadRequest(format!(
                "File path escapes worktree root: {}",
                canon.display()
            )));
        }

        Ok(canon)
    }
}

impl Clone for NeovimManager {
    fn clone(&self) -> Self {
        Self {
            processes: self.processes.clone(),
        }
    }
}

#[allow(dead_code)]
fn extract_version(api_info: &[Value]) -> String {
    // get_api_info returns [channel_id, metadata]; metadata.version has
    // major/minor/patch integer fields (no combined "number" field).
    let Some(Value::Map(pairs)) = api_info.get(1) else {
        return String::new();
    };
    let Some((_, Value::Map(version_map))) = pairs
        .iter()
        .find(|(k, _)| k.as_str().is_some_and(|s| s == "version"))
    else {
        return String::new();
    };

    let field = |name: &str| -> Option<i64> {
        version_map
            .iter()
            .find(|(k, _)| k.as_str().is_some_and(|s| s == name))
            .and_then(|(_, v)| v.as_i64())
    };

    match (field("major"), field("minor"), field("patch")) {
        (Some(major), Some(minor), Some(patch)) => format!("{major}.{minor}.{patch}"),
        _ => String::new(),
    }
}

#[allow(dead_code)]
fn build_nvim_command() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("nvim");
    cmd.arg("--embed").arg("-u").arg("NONE").arg("--headless");
    cmd
}

#[allow(dead_code)]
#[derive(Default, Clone)]
struct DefaultHandler;

unsafe impl Sync for DefaultHandler {}

#[allow(dead_code)]
impl DefaultHandler {
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl nvim_rs::Handler for DefaultHandler {
    type Writer = tokio_util::compat::Compat<tokio::process::ChildStdin>;
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn nvim_available() -> bool {
        std::process::Command::new("nvim")
            .arg("--version")
            .output()
            .is_ok()
    }

    #[tokio::test]
    async fn start_returns_api_info_when_nvim_available() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        let info = manager.start(1).await.expect("start should succeed");
        eprintln!("API info version: {:?}", info.version);
        assert!(!info.version.is_empty());
    }

    #[tokio::test]
    async fn stop_removes_process_and_is_idempotent() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(7).await.unwrap();
        manager.stop(7).await.unwrap();
        assert!(!manager.is_running(7).await);
        let result = manager.stop(7).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn crashed_process_is_removed_from_map() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(9).await.unwrap();
        manager.stop(9).await.unwrap();
        let restarted = manager.start(9).await.unwrap();
        assert!(!restarted.version.is_empty());
        assert!(manager.is_running(9).await);
    }

    #[tokio::test]
    async fn push_buffer_succeeds_for_running_process() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(42).await.unwrap();
        let result = manager.push_buffer(42, "src/scratch_42.txt", "hello\nworld").await;
        assert!(result.is_ok());
        manager.stop(42).await.unwrap();
    }

    #[tokio::test]
    async fn push_buffer_fails_for_not_running_process() {
        let manager = NeovimManager::new();
        let result = manager.push_buffer(99, "/tmp/test.txt", "content").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn push_then_pull_roundtrips_exact_content() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(200).await.unwrap();
        manager
            .push_buffer(200, "src/scratch_200.rs", "fn main() {}\n")
            .await
            .unwrap();
        let content = manager.pull_buffer(200, "src/scratch_200.rs").await.unwrap();
        assert_eq!(content, "fn main() {}\n");
    }

    #[tokio::test]
    async fn push_then_pull_roundtrips_unicode_and_no_trailing_newline() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(201).await.unwrap();
        let original = "// café 🦀\nlet x = 1;";
        manager
            .push_buffer(201, "src/scratch_201.rs", original)
            .await
            .unwrap();
        let content = manager.pull_buffer(201, "src/scratch_201.rs").await.unwrap();
        assert_eq!(content, original);
    }

    #[tokio::test]
    async fn pull_without_prior_push_fails_with_buffer_not_found() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(202).await.unwrap();
        let result = manager.pull_buffer(202, "never/pushed.rs").await;
        assert!(matches!(
            result,
            Err(AppError::NeovimBufferNotFound { .. })
        ));
    }

    #[tokio::test]
    async fn pull_without_running_process_fails() {
        let manager = NeovimManager::new();
        let result = manager.pull_buffer(203, "src/main.rs").await;
        assert!(matches!(
            result,
            Err(AppError::NeovimProcessNotRunning)
        ));
    }

    #[tokio::test]
    async fn second_push_to_same_path_reuses_cached_bufnr() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(204).await.unwrap();
        manager.push_buffer(204, "src/scratch_202.rs", "v1").await.unwrap();
        manager.push_buffer(204, "src/scratch_202.rs", "v2").await.unwrap();
        let content = manager.pull_buffer(204, "src/scratch_202.rs").await.unwrap();
        assert_eq!(content, "v2");
        let processes = manager.processes.lock().await;
        assert_eq!(processes.get(&204).unwrap().buffers.len(), 1);
    }
}
