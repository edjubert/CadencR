use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::CommandBuilder;
use tokio::sync::Mutex;

use crate::domain::terminal::service::PtyManager;
use crate::error::AppError;

use nvim_rs::rpc::handler::Dummy;

use super::protocol::NeovimStartResponse;

/// How long a first-time spawn may take before it is treated as failed. Kept
/// wide because a fresh user config's plugin manager installs everything on
/// its first launch, which routinely takes tens of seconds.
const SPAWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

/// A running Neovim process for one feature: its PTY (display) and its
/// control socket (programmatic file-open / cursor jumps).
struct NeovimHandle {
    pty_id: String,
    #[allow(dead_code)]
    control_socket: PathBuf,
    /// Owned so the socket's temp directory outlives the process.
    _socket_dir: tempfile::TempDir,
}

/// Supervises one real Neovim process per feature. All PTY plumbing (reader
/// task, output broadcast, scrollback, resize, kill) is delegated to
/// `PtyManager`; this type only owns the feature → process mapping and the
/// control socket path.
pub struct NeovimManager {
    processes: Arc<Mutex<HashMap<i64, NeovimHandle>>>,
    /// Serializes the spawn sequence across features so Cadencr never triggers
    /// two simultaneous first-time plugin installs into the same shared
    /// plugin directory.
    spawn_lock: Arc<Mutex<()>>,
    pty_manager: PtyManager,
}

impl NeovimManager {
    pub fn new(pty_manager: PtyManager) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            spawn_lock: Arc::new(Mutex::new(())),
            pty_manager,
        }
    }

    /// Start (or return the already-running) Neovim process for `feature_id`.
    pub async fn start(&self, feature_id: i64) -> Result<NeovimStartResponse, AppError> {
        if self.is_running(feature_id).await {
            return Ok(NeovimStartResponse {
                version: nvim_version().await,
            });
        }

        let _spawn_guard = self.spawn_lock.lock().await;

        // Re-check under the lock: another task may have spawned this feature
        // while we waited.
        if self.is_running(feature_id).await {
            return Ok(NeovimStartResponse {
                version: nvim_version().await,
            });
        }

        let socket_dir = tempfile::tempdir().map_err(|e| AppError::NeovimSpawnError {
            detail: format!("failed to create control socket directory: {e}"),
        })?;
        let control_socket = socket_dir.path().join(format!("nvim-{feature_id}.sock"));

        let mut cmd = CommandBuilder::new("nvim");
        cmd.arg("--listen");
        cmd.arg(&control_socket);
        // GUI-launched service processes (the Electron sidecar) don't inherit
        // the user's login-shell PATH, so a Homebrew-installed `nvim` resolves
        // in a terminal but not here. Widen PATH when the login shell gives us
        // one; otherwise keep the inherited value.
        if let Some(login_path) = cli_discovery::login_shell_path().await {
            cmd.env("PATH", login_path);
        }

        let cwd = std::env::temp_dir().to_string_lossy().into_owned();
        let (pty_id, _handle) = self
            .pty_manager
            .create_pty_with_command(feature_id, cmd, &cwd, 120, 40)
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        wait_for_socket(&control_socket).await?;

        self.processes.lock().await.insert(
            feature_id,
            NeovimHandle {
                pty_id,
                control_socket,
                _socket_dir: socket_dir,
            },
        );

        Ok(NeovimStartResponse {
            version: nvim_version().await,
        })
    }

    /// Kill the feature's Neovim process and forget it.
    pub async fn stop(&self, feature_id: i64) -> Result<(), AppError> {
        let handle = self.processes.lock().await.remove(&feature_id).ok_or(
            AppError::NeovimNotRunning {
                feature_id: feature_id.to_string(),
            },
        )?;
        self.pty_manager
            .kill_pty(&handle.pty_id)
            .map_err(|e| AppError::NeovimSpawnError {
                detail: format!("failed to kill neovim pty: {e}"),
            })?;
        Ok(())
    }

    pub(crate) async fn is_running(&self, feature_id: i64) -> bool {
        self.processes.lock().await.contains_key(&feature_id)
    }

    /// PTY id backing this feature's Neovim, so the WS layer can attach to the
    /// existing broadcast channel rather than opening a second stream.
    #[allow(dead_code)]
    pub(crate) async fn pty_id(&self, feature_id: i64) -> Option<String> {
        self.processes
            .lock()
            .await
            .get(&feature_id)
            .map(|handle| handle.pty_id.clone())
    }

    /// Path of this feature's `--listen` control socket.
    #[allow(dead_code)]
    pub(crate) async fn control_socket_path(&self, feature_id: i64) -> Option<PathBuf> {
        self.processes
            .lock()
            .await
            .get(&feature_id)
            .map(|handle| handle.control_socket.clone())
    }

    /// Open `path` in this feature's Neovim and move the cursor there.
    ///
    /// `line` and `col` are 1-indexed, matching how humans write a reference
    /// (`main.rs:240:2` = line 240, 2nd character). Neovim's
    /// `nvim_win_set_cursor` wants a 1-indexed line but a 0-indexed column, so
    /// the column is decremented on the way in.
    pub async fn open_file(
        &self,
        feature_id: i64,
        path: &str,
        line: Option<u32>,
        col: Option<u32>,
    ) -> Result<(), AppError> {
        let socket = self
            .control_socket_path(feature_id)
            .await
            .ok_or(AppError::NeovimProcessNotRunning)?;

        let (nvim, _io) = nvim_rs::create::tokio::new_path(
            &socket,
            Dummy::new(),
        )
        .await
        .map_err(|e| AppError::NeovimSpawnError {
            detail: format!("control socket unavailable: {e}"),
        })?;

        nvim.command(&format!("edit {}", escape_for_ex(path)))
            .await
            .map_err(|_| AppError::NeovimFileNotFound {
                path: path.to_string(),
            })?;

        let target_line = line.unwrap_or(1).max(1) as i64;
        let target_col = col.unwrap_or(1).max(1) as i64 - 1;
        let window = nvim.get_current_win().await.map_err(|e| {
            AppError::NeovimSpawnError {
                detail: e.to_string(),
            }
        })?;
        window
            .set_cursor((target_line, target_col))
            .await
            .map_err(|e| AppError::NeovimSpawnError {
                detail: e.to_string(),
            })?;

        Ok(())
    }

    /// Current cursor position as Neovim reports it: (1-indexed line,
    /// 0-indexed column). Used by tests to assert `open_file` landed correctly.
    #[cfg(test)]
    pub(crate) async fn cursor_position(&self, feature_id: i64) -> Result<(i64, i64), AppError> {
        let socket = self
            .control_socket_path(feature_id)
            .await
            .ok_or(AppError::NeovimProcessNotRunning)?;
        let (nvim, _io) = nvim_rs::create::tokio::new_path(
            &socket,
            Dummy::new(),
        )
        .await
        .map_err(|e| AppError::NeovimSpawnError {
            detail: e.to_string(),
        })?;
        let window = nvim.get_current_win().await.map_err(|e| {
            AppError::NeovimSpawnError {
                detail: e.to_string(),
            }
        })?;
        window.get_cursor().await.map_err(|e| AppError::NeovimSpawnError {
            detail: e.to_string(),
        })
    }
}

impl Clone for NeovimManager {
    fn clone(&self) -> Self {
        Self {
            processes: self.processes.clone(),
            spawn_lock: self.spawn_lock.clone(),
            pty_manager: self.pty_manager.clone(),
        }
    }
}

/// Poll until `nvim --listen` has created its socket, or the spawn ceiling
/// elapses. Neovim creates the socket only once startup (including any
/// first-time plugin installation) has progressed far enough to serve RPC.
async fn wait_for_socket(path: &std::path::Path) -> Result<(), AppError> {
    let deadline = tokio::time::Instant::now() + SPAWN_TIMEOUT;
    while tokio::time::Instant::now() < deadline {
        if path.exists() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(AppError::NeovimHandshakeTimeout)
}

/// Version string from `nvim --version`'s first line (e.g. "NVIM v0.10.2"),
/// resolving PATH the same way the spawn path does so both agree on which
/// binary is in play. Empty when nvim is unavailable.
async fn nvim_version() -> String {
    let mut cmd = tokio::process::Command::new("nvim");
    cmd.arg("--version");
    if let Some(login_path) = cli_discovery::login_shell_path().await {
        cmd.env("PATH", login_path);
    }
    let Ok(output) = cmd.output().await else {
        return String::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Whether `nvim` is spawnable, resolving PATH the same way `start` does.
pub async fn nvim_available() -> bool {
    !nvim_version().await.is_empty()
}

/// Escape a path for use as an argument to an ex-command. Neovim treats
/// spaces as argument separators and `%`/`#` as buffer shorthands, so a real
/// path containing them would otherwise open the wrong file.
fn escape_for_ex(path: &str) -> String {
    path.replace('\\', "\\\\")
        .replace(' ', "\\ ")
        .replace('%', "\\%")
        .replace('#', "\\#")
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Arc;
    use tokio::sync::Mutex;

    use super::*;

    pub(crate) async fn nvim_available_test() -> bool {
        let Some(login_path) = cli_discovery::login_shell_path().await else {
            return false;
        };
        std::process::Command::new("nvim")
            .arg("--version")
            .env("PATH", &login_path)
            .output()
            .is_ok()
    }

    fn test_manager() -> NeovimManager {
        NeovimManager::new(PtyManager::new())
    }

    #[tokio::test]
    async fn start_spawns_a_pty_and_reports_a_version() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found in test environment");
            return;
        }
        let manager = test_manager();
        let info = manager.start(1).await.expect("start should succeed");
        assert!(!info.version.is_empty(), "version should be reported");
        assert!(manager.is_running(1).await);
        manager.stop(1).await.unwrap();
    }

    #[tokio::test]
    async fn start_is_idempotent_for_the_same_feature() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = test_manager();
        manager.start(2).await.unwrap();
        let pty_id_first = manager.pty_id(2).await.expect("pty id after first start");
        manager.start(2).await.unwrap();
        let pty_id_second = manager.pty_id(2).await.expect("pty id after second start");
        assert_eq!(
            pty_id_first, pty_id_second,
            "a second start must reuse the running process, not spawn another"
        );
        manager.stop(2).await.unwrap();
    }

    #[tokio::test]
    async fn stop_removes_the_feature_and_is_reported_as_not_running() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = test_manager();
        manager.start(3).await.unwrap();
        manager.stop(3).await.unwrap();
        assert!(!manager.is_running(3).await);
        assert!(matches!(
            manager.stop(3).await,
            Err(AppError::NeovimNotRunning { .. })
        ));
    }

    #[tokio::test]
    async fn start_creates_a_listening_control_socket() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = test_manager();
        manager.start(4).await.unwrap();
        let socket = manager
            .control_socket_path(4)
            .await
            .expect("socket path should be recorded");
        assert!(
            socket.exists(),
            "nvim --listen should have created the socket at {}",
            socket.display()
        );
        manager.stop(4).await.unwrap();
    }

    #[tokio::test]
    async fn stopping_an_unknown_feature_errors() {
        let manager = test_manager();
        assert!(matches!(
            manager.stop(999).await,
            Err(AppError::NeovimNotRunning { .. })
        ));
    }

    #[tokio::test]
    async fn concurrent_first_time_spawns_do_not_overlap() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let events: Arc<Mutex<Vec<(i64, &'static str, std::time::Instant)>>> =
            Arc::new(Mutex::new(Vec::new()));
        let manager = test_manager();

        let events_a = events.clone();
        let manager_a = manager.clone();
        let handle_a = tokio::spawn(async move {
            events_a.lock().await.push((901, "start", std::time::Instant::now()));
            manager_a.start(901).await.unwrap();
            events_a.lock().await.push((901, "end", std::time::Instant::now()));
        });

        let events_b = events.clone();
        let manager_b = manager.clone();
        let handle_b = tokio::spawn(async move {
            events_b.lock().await.push((902, "start", std::time::Instant::now()));
            manager_b.start(902).await.unwrap();
            events_b.lock().await.push((902, "end", std::time::Instant::now()));
        });

        let _ = tokio::join!(handle_a, handle_b);

        let log = events.lock().await;
        let at = |id: i64, kind: &str| {
            log.iter()
                .find(|(i, k, _)| *i == id && *k == kind)
                .unwrap()
                .2
        };
        let (first_end, second_start) = if at(901, "start") <= at(902, "start") {
            (at(901, "end"), at(902, "start"))
        } else {
            (at(902, "end"), at(901, "start"))
        };
        assert!(
            second_start >= first_end - std::time::Duration::from_millis(50),
            "spawns overlapped despite the spawn lock"
        );
        drop(log);

        manager.stop(901).await.unwrap();
        manager.stop(902).await.unwrap();
    }

    #[tokio::test]
    async fn open_file_places_the_cursor_at_the_requested_line_and_column() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.txt");
        std::fs::write(&file, "alpha\nbravo\ncharlie\ndelta\n").unwrap();

        let manager = test_manager();
        manager.start(10).await.unwrap();
        manager
            .open_file(10, file.to_str().unwrap(), Some(3), Some(2))
            .await
            .expect("open_file should succeed");

        let position = manager.cursor_position(10).await.expect("read cursor back");
        assert_eq!(
            position,
            (3, 1),
            "line stays 1-indexed, human column 2 becomes 0-indexed 1"
        );
        manager.stop(10).await.unwrap();
    }

    #[tokio::test]
    async fn open_file_without_line_defaults_to_the_top_of_the_file() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.txt");
        std::fs::write(&file, "alpha\nbravo\n").unwrap();

        let manager = test_manager();
        manager.start(11).await.unwrap();
        manager
            .open_file(11, file.to_str().unwrap(), None, None)
            .await
            .expect("open_file should succeed");

        let position = manager.cursor_position(11).await.expect("read cursor back");
        assert_eq!(position, (1, 0));
        manager.stop(11).await.unwrap();
    }

    #[tokio::test]
    async fn open_file_on_a_missing_file_reports_file_not_found() {
        if !nvim_available_test().await {
            eprintln!("SKIP: nvim binary not found");
            return;
        }
        let manager = test_manager();
        manager.start(12).await.unwrap();
        let result = manager
            .open_file(12, "/definitely/does/not/exist.txt", Some(1), None)
            .await;
        manager.stop(12).await.unwrap();
        assert!(matches!(result, Err(AppError::NeovimFileNotFound { .. })));
    }

    #[tokio::test]
    async fn open_file_without_a_running_process_errors() {
        let manager = test_manager();
        let result = manager.open_file(13, "/tmp/whatever.txt", None, None).await;
        assert!(matches!(result, Err(AppError::NeovimProcessNotRunning)));
    }

    #[test]
    fn escape_for_ex_escapes_spaces_and_buffer_shorthands() {
        assert_eq!(escape_for_ex("/tmp/a b.rs"), "/tmp/a\\ b.rs");
        assert_eq!(escape_for_ex("/tmp/100%.rs"), "/tmp/100\\%.rs");
        assert_eq!(escape_for_ex("/tmp/i#1.rs"), "/tmp/i\\#1.rs");
        assert_eq!(escape_for_ex("/tmp/plain.rs"), "/tmp/plain.rs");
    }
}
