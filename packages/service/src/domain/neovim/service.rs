use std::collections::HashMap;
use std::sync::Arc;

use nvim_rs::Value;
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::error::AppError;

#[allow(dead_code)]
pub struct NeovimApiInfo {
    pub version: String,
}

#[allow(dead_code)]
struct NeovimHandle {
    feature_id: i64,
    api_info: NeovimApiInfo,
    child: Arc<Mutex<Child>>,
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

    pub async fn start(&self, feature_id: i64) -> Result<NeovimApiInfo, AppError> {
        let mut processes = self.processes.lock().await;
        if let Some(existing) = processes.get(&feature_id) {
            return Ok(NeovimApiInfo {
                version: existing.api_info.version.clone(),
            });
        }

        let mut cmd = build_nvim_command();

        let (nvim, _io_handle, child) = nvim_rs::create::tokio::new_child_cmd(
            &mut cmd,
            DefaultHandler::new(),
        )
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
            api_info: NeovimApiInfo { version: version.clone() },
            child: child.clone(),
        };
        processes.insert(feature_id, handle);
        drop(processes);

        let processes_for_waiter = self.processes.clone();
        let child_for_waiter = child.clone();
        tokio::spawn(async move {
            let _ = child_for_waiter.lock().await.wait().await;
            // Only remove the map entry if it's still the process we waited on —
            // a later start() for the same feature_id may already have replaced it.
            let mut processes = processes_for_waiter.lock().await;
            if processes
                .get(&feature_id)
                .is_some_and(|handle| Arc::ptr_eq(&handle.child, &child))
            {
                processes.remove(&feature_id);
            }
        });

        Ok(NeovimApiInfo { version })
    }

    pub async fn stop(&self, feature_id: i64) {
        let mut processes = self.processes.lock().await;
        if let Some(handle) = processes.remove(&feature_id) {
            // Process may have already exited; ignore kill-on-dead-process errors —
            // this is best-effort cleanup, not a user-facing operation.
            let _ = handle.child.lock().await.kill().await;
        }
    }

    pub(crate) async fn is_running(&self, feature_id: i64) -> bool {
        self.processes.lock().await.contains_key(&feature_id)
    }
}

#[allow(dead_code)]
fn extract_version(api_info: &[Value]) -> String {
    // get_api_info returns [channel_id, metadata]; metadata.version has
    // major/minor/patch integer fields (no combined "number" field).
    let Some(Value::Map(pairs)) = api_info.get(1) else {
        return String::new();
    };
    let Some((_, Value::Map(version_map))) =
        pairs.iter().find(|(k, _)| k.as_str().is_some_and(|s| s == "version"))
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
mod tests {
    use super::*;

    pub(crate) fn nvim_available() -> bool {
        std::process::Command::new("nvim").arg("--version").output().is_ok()
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
        manager.stop(7).await; // should not error
        assert!(!manager.is_running(7).await);
        manager.stop(7).await; // stopping again: still should not error
    }

    #[tokio::test]
    async fn crashed_process_is_removed_from_map() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        manager.start(9).await.unwrap();
        manager.stop(9).await;
        let restarted = manager.start(9).await.unwrap();
        assert!(!restarted.version.is_empty());
        assert!(manager.is_running(9).await);
    }
}
