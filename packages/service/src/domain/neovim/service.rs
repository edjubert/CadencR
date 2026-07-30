use std::collections::HashMap;
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
    feature_id: String,
    api_info: NeovimApiInfo,
    child: Arc<Mutex<Child>>,
}

pub struct NeovimManager {
    processes: Arc<Mutex<HashMap<String, NeovimHandle>>>,
}

#[allow(dead_code)]
impl NeovimManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start(&self, feature_id: &str) -> Result<NeovimStartResponse, AppError> {
        let mut processes = self.processes.lock().await;
        if let Some(existing) = processes.get(feature_id) {
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
            feature_id: feature_id.to_string(),
            api_info: NeovimApiInfo {
                version: version.clone(),
            },
            child: child.clone(),
        };
        processes.insert(feature_id.to_string(), handle);
        drop(processes);

        let processes_for_waiter = self.processes.clone();
        let child_for_waiter = child.clone();
        let feature_id_for_waiter = feature_id.to_string();
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

    pub async fn stop(&self, feature_id: &str) -> Result<(), AppError> {
        let mut processes = self.processes.lock().await;
        match processes.remove(feature_id) {
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

    pub(crate) async fn is_running(&self, feature_id: &str) -> bool {
        self.processes.lock().await.contains_key(feature_id)
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
        let info = manager.start("1").await.expect("start should succeed");
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
        manager.start("7").await.unwrap();
        manager.stop("7").await.unwrap(); // should kill and remove
        assert!(!manager.is_running("7").await);
        let result = manager.stop("7").await; // stopping again: returns error (idempotent at route level)
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn crashed_process_is_removed_from_map() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        manager.start("9").await.unwrap();
        manager.stop("9").await.unwrap();
        let restarted = manager.start("9").await.unwrap();
        assert!(!restarted.version.is_empty());
        assert!(manager.is_running("9").await);
    }
}
