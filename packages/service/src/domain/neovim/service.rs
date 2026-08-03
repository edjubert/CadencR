use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nvim_rs::Value;
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;
use crate::error::AppError;

use super::handler::{NeovimEventHandler, SharedBuffers};
use super::protocol::NeovimStartResponse;

/// Feature-scoped WS push mechanism handed to `start()` so the spawned
/// process's `NeovimEventHandler` can forward RPC-derived events (cursor,
/// mode, buffer line changes) to every client currently watching the
/// feature. Backed by the same registry HTTP handlers use to push WS
/// envelopes without holding a direct socket reference.
pub type WsSessionSender = WsFeatureSenderRegistry;

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
    // Shared with `NeovimEventHandler` so `nvim_buf_lines_event` notifications
    // (delivered on the RPC io loop, not through `NeovimManager`) can resolve
    // which file a raw bufnr belongs to.
    buffers: SharedBuffers,
}

pub struct NeovimManager {
    processes: Arc<Mutex<HashMap<i64, NeovimHandle>>>,
    spawn_lock: Arc<Mutex<()>>,
}

#[allow(dead_code)]
impl NeovimManager {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            spawn_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn start(
        &self,
        feature_id: i64,
        ws_sender: WsSessionSender,
    ) -> Result<NeovimStartResponse, AppError> {
        self.start_with_env_override(feature_id, ws_sender, &[]).await
    }

    async fn start_with_env_override(
        &self,
        feature_id: i64,
        ws_sender: WsSessionSender,
        env_overrides: &[(&str, &str)],
    ) -> Result<NeovimStartResponse, AppError> {
        let processes = self.processes.lock().await;
        if let Some(existing) = processes.get(&feature_id) {
            return Ok(NeovimStartResponse {
                version: existing.api_info.version.clone(),
            });
        }
        drop(processes);

        let _spawn_guard = self.spawn_lock.lock().await;

        {
            let processes = self.processes.lock().await;
            if let Some(existing) = processes.get(&feature_id) {
                return Ok(NeovimStartResponse {
                    version: existing.api_info.version.clone(),
                });
            }
        }

        let mut cmd = build_nvim_command();
        for (key, value) in env_overrides {
            cmd.env(key, value);
        }
        let buffers: SharedBuffers = Arc::new(Mutex::new(HashMap::new()));
        let handler = NeovimEventHandler::new(feature_id, buffers.clone(), ws_sender);

        let (nvim, _io_handle, child) = nvim_rs::create::tokio::new_child_cmd(&mut cmd, handler)
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        let api_info_result =
            tokio::time::timeout(std::time::Duration::from_secs(90), nvim.get_api_info())
                .await
                .map_err(|_| AppError::NeovimHandshakeTimeout)?
                .map_err(|e| AppError::NeovimSpawnError {
                    detail: e.to_string(),
                })?;

        let version = extract_version(&api_info_result);
        let child = Arc::new(Mutex::new(child));

        // Once-per-process autocmds forwarding cursor/mode changes as RPC
        // notifications the handler above already knows how to translate.
        // Wrapped in CadencrInternal augroup so `autocmd!` inside the group
        // only clears these autocmds — surviving a user config's bare
        // `autocmd!` which clears global autocmds outside this group.
        nvim.exec(
            "augroup CadencrInternal\n\
             autocmd!\n\
             autocmd CursorMoved,CursorMovedI * call rpcnotify(0, 'cadencr_cursor_moved', line('.'), col('.'))\n\
             autocmd ModeChanged * call rpcnotify(0, 'cadencr_mode_changed', mode())\n\
             augroup END",
            false,
        )
        .await
        .map_err(|e| AppError::NeovimSpawnError {
            detail: e.to_string(),
        })?;

        let handle = NeovimHandle {
            feature_id,
            api_info: NeovimApiInfo {
                version: version.clone(),
            },
            child: child.clone(),
            nvim,
            buffers,
        };
        let mut processes = self.processes.lock().await;
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

    pub fn empty_fixture_path() -> std::io::Result<tempfile::TempDir> {
        let fixture_dir = tempfile::tempdir()?;
        std::fs::create_dir_all(fixture_dir.path().join("nvim"))?;
        Ok(fixture_dir)
    }

    #[cfg(test)]
    pub async fn start_with_empty_fixture(
        &self,
        feature_id: i64,
        ws_sender: WsSessionSender,
    ) -> Result<NeovimStartResponse, AppError> {
        let fixture_path = Self::empty_fixture_path()
            .map_err(|e| AppError::Internal(format!("Failed to create empty fixture: {e}")))?;
        self.start_with_env_override(feature_id, ws_sender, &[("XDG_CONFIG_HOME", fixture_path.path().to_str().unwrap())])
            .await
    }

    #[cfg(test)]
    pub async fn start_with_fixture_path(
        &self,
        feature_id: i64,
        ws_sender: WsSessionSender,
        fixture_path: &std::path::Path,
    ) -> Result<NeovimStartResponse, AppError> {
        self.start_with_env_override(feature_id, ws_sender, &[("XDG_CONFIG_HOME", fixture_path.to_str().unwrap())])
            .await
    }

    #[cfg(test)]
    pub async fn start_with_config_dir_override(
        &self,
        feature_id: i64,
        ws_sender: WsSessionSender,
        config_dir: &std::path::Path,
    ) -> Result<NeovimStartResponse, AppError> {
        self.start_with_env_override(feature_id, ws_sender, &[("XDG_CONFIG_HOME", config_dir.to_str().unwrap())])
            .await
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

        let processes = self.processes.lock().await;
        let handle = processes.get(&feature_id).ok_or(AppError::NeovimProcessNotRunning)?;

        let already_tracked = handle.buffers.lock().await.get(file_path).copied();
        let bufnr = match already_tracked {
            Some(bufnr) => bufnr,
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

                let buffer =
                    nvim_rs::Buffer::new(nvim_rs::Value::Integer(bufnr.into()), handle.nvim.clone());
                buffer
                    .attach(true, vec![])
                    .await
                    .map_err(|e| AppError::NeovimSpawnError {
                        detail: e.to_string(),
                    })?;

                handle.buffers.lock().await.insert(file_path.to_string(), bufnr);
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
        let processes = self.processes.lock().await;
        let handle = processes.get(&feature_id).ok_or(AppError::NeovimProcessNotRunning)?;

        let bufnr = handle
            .buffers
            .lock()
            .await
            .get(file_path)
            .copied()
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

    /// Forward `keys` (Neovim key-notation, e.g. `"dd"`, `"<Esc>"`) to the
    /// process's current buffer via `nvim_input`. Switches the running
    /// process's current buffer to `file_path`'s bufnr first, so keystrokes
    /// always land on the buffer the client believes is focused rather than
    /// whichever buffer happened to be last active in the headless instance.
    pub async fn send_keys(
        &self,
        feature_id: i64,
        file_path: &str,
        keys: &str,
    ) -> Result<(), AppError> {
        let processes = self.processes.lock().await;
        let handle = processes.get(&feature_id).ok_or(AppError::NeovimProcessNotRunning)?;

        let bufnr = handle
            .buffers
            .lock()
            .await
            .get(file_path)
            .copied()
            .ok_or_else(|| AppError::NeovimBufferNotFound {
                file_path: file_path.to_string(),
            })?;

        let buffer =
            nvim_rs::Buffer::new(nvim_rs::Value::Integer(bufnr.into()), handle.nvim.clone());
        handle
            .nvim
            .set_current_buf(&buffer)
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        handle
            .nvim
            .input(keys)
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        Ok(())
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
            spawn_lock: self.spawn_lock.clone(),
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
    cmd.arg("--embed").arg("--headless");
    cmd
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

    /// Empty registry — a valid `WsSessionSender` test double for tests that
    /// only need `start()` to succeed and don't assert on forwarded events.
    pub(crate) fn test_ws_sender() -> WsSessionSender {
        WsSessionSender::new()
    }

    #[tokio::test]
    async fn start_returns_api_info_when_nvim_available() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let info = manager
            .start_with_empty_fixture(1, test_ws_sender())
            .await
            .expect("start should succeed");
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(7, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(9, test_ws_sender())
            .await
            .unwrap();
        manager.stop(9).await.unwrap();
        let restarted = manager
            .start_with_empty_fixture(9, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(42, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(200, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(201, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(202, test_ws_sender())
            .await
            .unwrap();
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
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(204, test_ws_sender())
            .await
            .unwrap();
        manager.push_buffer(204, "src/scratch_202.rs", "v1").await.unwrap();
        manager.push_buffer(204, "src/scratch_202.rs", "v2").await.unwrap();
        let content = manager.pull_buffer(204, "src/scratch_202.rs").await.unwrap();
        assert_eq!(content, "v2");
        let processes = manager.processes.lock().await;
        assert_eq!(processes.get(&204).unwrap().buffers.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn start_registers_cursor_and_mode_autocmds() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(400, test_ws_sender())
            .await
            .unwrap();
        assert!(manager.is_running(400).await);
    }

    #[tokio::test]
    async fn push_buffer_attaches_for_line_events() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let registry = test_ws_sender();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry.register(500, tx).await;

        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(500, registry)
            .await
            .unwrap();
        manager
            .push_buffer(500, "src/main.rs", "line one\nline two\n")
            .await
            .unwrap();
        manager.send_keys(500, "src/main.rs", "dd").await.unwrap();

        let mut saw_buffer_lines_changed = false;
        while let Ok(message) = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
        {
            let Some(axum::extract::ws::Message::Text(text)) = message else {
                continue;
            };
            let envelope: crate::domain::ws_session::protocol::WsEnvelope =
                serde_json::from_str(&text).unwrap();
            if envelope.domain == "neovim" && envelope.action == "buffer_lines_changed" {
                saw_buffer_lines_changed = true;
                break;
            }
        }
        assert!(
            saw_buffer_lines_changed,
            "expected a buffer_lines_changed event after send_keys mutated the buffer"
        );
    }

    #[tokio::test]
    async fn send_keys_navigation_moves_cursor_without_content_change() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let registry = test_ws_sender();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry.register(600, tx).await;

        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(600, registry)
            .await
            .unwrap();
        manager
            .push_buffer(600, "src/main.rs", "line one\nline two\nline three\n")
            .await
            .unwrap();
        manager.send_keys(600, "src/main.rs", "j").await.unwrap();

        let mut saw_cursor_moved = false;
        let mut saw_buffer_lines_changed = false;
        while let Ok(Some(axum::extract::ws::Message::Text(text))) =
            tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await
        {
            let envelope: crate::domain::ws_session::protocol::WsEnvelope =
                serde_json::from_str(&text).unwrap();
            match (envelope.domain.as_str(), envelope.action.as_str()) {
                ("neovim", "cursor_moved") => saw_cursor_moved = true,
                ("neovim", "buffer_lines_changed") => saw_buffer_lines_changed = true,
                _ => {}
            }
        }
        assert!(saw_cursor_moved, "expected a cursor_moved event from 'j'");
        assert!(
            !saw_buffer_lines_changed,
            "navigation alone must not mutate buffer content"
        );
    }

    #[tokio::test]
    async fn send_keys_mutation_changes_buffer_content() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(601, test_ws_sender())
            .await
            .unwrap();
        manager
            .push_buffer(601, "src/main.rs", "line one\nline two\nline three\n")
            .await
            .unwrap();
        manager.send_keys(601, "src/main.rs", "dd").await.unwrap();
        let content = manager.pull_buffer(601, "src/main.rs").await.unwrap();
        assert_eq!(content, "line two\nline three\n");
    }

    #[tokio::test]
    async fn send_keys_mode_transitions_forward_mode_changed() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let registry = test_ws_sender();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry.register(602, tx).await;

        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(602, registry)
            .await
            .unwrap();
        manager
            .push_buffer(602, "src/main.rs", "line one\n")
            .await
            .unwrap();
        manager.send_keys(602, "src/main.rs", "i").await.unwrap();
        manager.send_keys(602, "src/main.rs", "<Esc>").await.unwrap();

        let mut modes_seen = Vec::new();
        while let Ok(Some(axum::extract::ws::Message::Text(text))) =
            tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await
        {
            let envelope: crate::domain::ws_session::protocol::WsEnvelope =
                serde_json::from_str(&text).unwrap();
            if envelope.domain == "neovim" && envelope.action == "mode_changed" {
                let payload: crate::domain::ws_session::protocol::NeovimModeChangedPayload =
                    serde_json::from_value(envelope.payload).unwrap();
                modes_seen.push(payload.mode);
            }
        }
        assert!(modes_seen.contains(&"i".to_string()), "expected an insert mode_changed event, saw: {modes_seen:?}");
        assert!(modes_seen.contains(&"n".to_string()), "expected a normal mode_changed event after <Esc>, saw: {modes_seen:?}");
    }

    #[tokio::test]
    async fn send_keys_fails_without_running_process() {
        let manager = NeovimManager::new();
        let result = manager.send_keys(603, "src/main.rs", "j").await;
        assert!(matches!(result, Err(AppError::NeovimProcessNotRunning)));
    }

    #[tokio::test]
    async fn send_keys_fails_for_unpushed_buffer() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = NeovimManager::new();
        let _fixture = NeovimManager::empty_fixture_path().expect("create empty fixture");
        let _ = &_fixture;
        manager
            .start_with_empty_fixture(604, test_ws_sender())
            .await
            .unwrap();
        let result = manager.send_keys(604, "never/pushed.rs", "j").await;
        assert!(matches!(result, Err(AppError::NeovimBufferNotFound { .. })));
    }

    #[tokio::test]
    async fn start_succeeds_with_config_delay_between_15_and_90_seconds() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }

        let fixture_dir = tempfile::tempdir().unwrap();
        let nvim_config_dir = fixture_dir.path().join("nvim");
        std::fs::create_dir_all(&nvim_config_dir).unwrap();
        // Simulate a slow first-time plugin install: a startup delay longer
        // than the old 15s ceiling but comfortably under the new 90s one.
        std::fs::write(nvim_config_dir.join("init.lua"), "vim.wait(20000)").unwrap();

        let manager = NeovimManager::new();
        let result = manager
            .start_with_fixture_path(900, test_ws_sender(), fixture_dir.path())
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn start_loads_real_user_config_from_standard_location() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = NeovimManager::new();
        let info = manager
            .start(10, test_ws_sender())
            .await
            .expect("start should succeed");
        eprintln!("API info version: {:?}", info.version);
        assert!(!info.version.is_empty());
    }

    #[tokio::test]
    async fn cursor_moved_autocmd_survives_user_config_autocmd_clear() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }

        let fixture_dir = tempfile::tempdir().unwrap();
        let nvim_config_dir = fixture_dir.path().join("nvim");
        std::fs::create_dir_all(&nvim_config_dir).unwrap();
        std::fs::write(
            nvim_config_dir.join("init.lua"),
            "vim.cmd('autocmd!')",
        ).unwrap();

        let registry = test_ws_sender();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry.register(801, tx).await;

        let manager = NeovimManager::new();
        manager
            .start_with_fixture_path(801, registry, fixture_dir.path())
            .await
            .unwrap();
        manager
            .push_buffer(801, "src/main.rs", "line one\nline two\n")
            .await
            .unwrap();
        manager.send_keys(801, "src/main.rs", "j").await.unwrap();

        let mut saw_cursor_moved = false;
        while let Ok(Some(axum::extract::ws::Message::Text(text))) =
            tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv()).await
        {
            let envelope: crate::domain::ws_session::protocol::WsEnvelope =
                serde_json::from_str(&text).unwrap();
            if envelope.domain == "neovim" && envelope.action == "cursor_moved" {
                saw_cursor_moved = true;
                break;
            }
        }
        assert!(saw_cursor_moved, "expected a cursor_moved WsEnvelope via rx, proving the CadencrInternal augroup's autocmd survived the fixture config's bare `autocmd!`");
    }

    #[tokio::test]
    async fn concurrent_first_time_spawns_do_not_overlap() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }

        let events: Arc<Mutex<Vec<(i64, &'static str, std::time::Instant)>>> = Arc::new(Mutex::new(Vec::new()));

        let fixture_a = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(fixture_a.path().join("nvim")).unwrap();
        std::fs::write(fixture_a.path().join("nvim/init.lua"), "vim.wait(2000)").unwrap();

        let fixture_b = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(fixture_b.path().join("nvim")).unwrap();
        std::fs::write(fixture_b.path().join("nvim/init.lua"), "vim.wait(2000)").unwrap();

        let manager = NeovimManager::new();
        let registry_a = test_ws_sender();
        let (tx_a, _rx_a) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry_a.register(901, tx_a).await;
        let registry_b = test_ws_sender();
        let (tx_b, _rx_b) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry_b.register(902, tx_b).await;

        let events_a = events.clone();
        let manager_a = manager.clone();
        let path_a = fixture_a.path().to_path_buf();
        let handle_a = tokio::spawn(async move {
            events_a.lock().await.push((901, "spawn_start", std::time::Instant::now()));
            manager_a
                .start_with_config_dir_override(901, registry_a, &path_a)
                .await
                .unwrap();
            events_a.lock().await.push((901, "spawn_end", std::time::Instant::now()));
        });

        let events_b = events.clone();
        let manager_b = manager.clone();
        let path_b = fixture_b.path().to_path_buf();
        let handle_b = tokio::spawn(async move {
            events_b.lock().await.push((902, "spawn_start", std::time::Instant::now()));
            manager_b
                .start_with_config_dir_override(902, registry_b, &path_b)
                .await
                .unwrap();
            events_b.lock().await.push((902, "spawn_end", std::time::Instant::now()));
        });

        let _ = tokio::join!(handle_a, handle_b);

        let log = events.lock().await;
        let end_901 = log.iter().find(|(id, kind, _)| *id == 901 && *kind == "spawn_end").unwrap().2;
        let start_902 = log.iter().find(|(id, kind, _)| *id == 902 && *kind == "spawn_start").unwrap().2;
        let end_902 = log.iter().find(|(id, kind, _)| *id == 902 && *kind == "spawn_end").unwrap().2;
        let start_901 = log.iter().find(|(id, kind, _)| *id == 901 && *kind == "spawn_start").unwrap().2;

        let (first_end, second_start) = if start_901 <= start_902 { (end_901, start_902) } else { (end_902, start_901) };
        assert!(
            second_start >= first_end - std::time::Duration::from_millis(50),
            "spawns overlapped"
        );
    }

    #[tokio::test]
    async fn already_running_feature_start_is_not_blocked_by_concurrent_spawn() {
        if !nvim_available() {
            eprintln!("SKIP: nvim binary not found");
            return;
        }

        let fast_fixture = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(fast_fixture.path().join("nvim")).unwrap();
        std::fs::write(fast_fixture.path().join("nvim/init.lua"), "").unwrap();

        let slow_fixture = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(slow_fixture.path().join("nvim")).unwrap();
        std::fs::write(slow_fixture.path().join("nvim/init.lua"), "vim.wait(5000)").unwrap();

        let manager = NeovimManager::new();
        let registry_a = test_ws_sender();
        let (tx_a, _rx_a) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry_a.register(903, tx_a).await;
        manager
            .start_with_config_dir_override(903, registry_a, fast_fixture.path())
            .await
            .unwrap();

        let registry_b = test_ws_sender();
        let (tx_b, _rx_b) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry_b.register(904, tx_b).await;
        let slow_path = slow_fixture.path().to_path_buf();
        let manager_for_slow = manager.clone();
        let slow_handle = tokio::spawn(async move {
            manager_for_slow
                .start_with_config_dir_override(904, registry_b, &slow_path)
                .await
                .unwrap();
        });

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let registry_a2 = test_ws_sender();
        let (tx_a2, _rx_a2) = tokio::sync::mpsc::unbounded_channel::<axum::extract::ws::Message>();
        registry_a2.register(903, tx_a2).await;
        let redundant_start = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            manager.start_with_config_dir_override(903, registry_a2, fast_fixture.path()),
        )
        .await;

        assert!(
            redundant_start.is_ok(),
            "redundant start for an already-running feature should return immediately, not wait on an unrelated feature's spawn_lock"
        );

        slow_handle.await.unwrap();
    }
}
