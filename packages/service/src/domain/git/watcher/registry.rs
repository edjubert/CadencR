#[cfg(test)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use axum::extract::ws::Message;
use tokio::sync::{mpsc, Mutex};

#[cfg(test)]
use super::handle::Subscriber;
use super::handle::{schedule_grace_drop, sender_eq, spawn_handle, RegistryInner};
use super::subscription::{push_subscriber_dedup, resolve_paths};
use crate::app_state::AppState;
use crate::domain::git::git_status::{self, GitStatusSnapshot};
use crate::domain::git::workflow_service;
use crate::error::AppError;

/// Public registry held by `AppState`. Cheap to clone (it's all an `Arc`).
pub struct GitWatcherRegistry {
    pub(super) inner: Arc<Mutex<RegistryInner>>,
}

impl GitWatcherRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryInner {
                handles: std::collections::HashMap::new(),
            })),
        }
    }

    /// Register a `(feature_id, sender)` subscription. Returns an initial
    /// snapshot the caller should send as the first envelope on this WS.
    /// Spawns the underlying fs watcher if this is the first subscriber for
    /// the resolved worktree path.
    pub async fn subscribe(
        &self,
        state: &AppState,
        feature_id: i64,
        sender: mpsc::UnboundedSender<Message>,
    ) -> Result<GitStatusSnapshot, AppError> {
        let (worktree_path, target_branch) = resolve_paths(state, feature_id).await?;
        let mut snapshot =
            git_status::compute_status_or_empty(&worktree_path, feature_id, &target_branch).await?;
        workflow_service::enrich_with_sharing(
            state,
            &mut snapshot,
            &worktree_path.to_string_lossy(),
        )
        .await;

        if !crate::shared::git_context::has_git_metadata(&worktree_path).await? {
            return Ok(snapshot);
        }

        let _ = target_branch;
        let mut inner = self.inner.lock().await;
        match inner.handles.get_mut(&worktree_path) {
            Some(handle) => {
                push_subscriber_dedup(&mut handle.subscribers, feature_id, sender);
                handle.cancel_grace();
                handle.epoch.fetch_add(1, Ordering::Relaxed);
            }
            None => {
                let mut handle =
                    spawn_handle(self.inner.clone(), worktree_path.clone(), state.clone())?;
                push_subscriber_dedup(&mut handle.subscribers, feature_id, sender);
                inner.handles.insert(worktree_path, handle);
            }
        }
        Ok(snapshot)
    }

    /// Drop every subscription for a given `feature_id`. Provided for
    /// completeness; the WS layer prefers `unsubscribe_one` so it doesn't
    /// kick other sessions watching the same feature.
    #[allow(dead_code)]
    pub async fn unsubscribe(&self, feature_id: i64) {
        let mut inner = self.inner.lock().await;
        let mut empty_paths: Vec<PathBuf> = Vec::new();
        for (path, handle) in inner.handles.iter_mut() {
            handle.subscribers.retain(|s| s.feature_id != feature_id);
            if handle.subscribers.is_empty() {
                empty_paths.push(path.clone());
            }
            handle.epoch.fetch_add(1, Ordering::Relaxed);
        }
        for path in empty_paths {
            schedule_grace_drop(&mut inner, &path, self.inner.clone());
        }
    }

    /// Drop the subscription tied to one `(feature_id, sender)` pair.
    pub async fn unsubscribe_one(&self, feature_id: i64, sender: &mpsc::UnboundedSender<Message>) {
        let mut inner = self.inner.lock().await;
        let mut empty_paths: Vec<PathBuf> = Vec::new();
        for (path, handle) in inner.handles.iter_mut() {
            handle
                .subscribers
                .retain(|s| !(s.feature_id == feature_id && sender_eq(&s.sender, sender)));
            if handle.subscribers.is_empty() {
                empty_paths.push(path.clone());
            }
            handle.epoch.fetch_add(1, Ordering::Relaxed);
        }
        for path in empty_paths {
            schedule_grace_drop(&mut inner, &path, self.inner.clone());
        }
    }

    /// Drop every subscription tied to a specific (closed/about-to-close)
    /// WS sender. Called from the WS connection cleanup hook.
    pub async fn unsubscribe_sender(&self, sender: &mpsc::UnboundedSender<Message>) {
        let mut inner = self.inner.lock().await;
        let mut empty_paths: Vec<PathBuf> = Vec::new();
        for (path, handle) in inner.handles.iter_mut() {
            handle.subscribers.retain(|s| !sender_eq(&s.sender, sender));
            if handle.subscribers.is_empty() {
                empty_paths.push(path.clone());
            }
            handle.epoch.fetch_add(1, Ordering::Relaxed);
        }
        for path in empty_paths {
            schedule_grace_drop(&mut inner, &path, self.inner.clone());
        }
    }

    #[cfg(test)]
    pub(super) async fn handle_count(&self) -> usize {
        self.inner.lock().await.handles.len()
    }

    #[cfg(test)]
    async fn subscriber_count(&self, path: &Path) -> usize {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let inner = self.inner.lock().await;
        inner
            .handles
            .get(&canonical)
            .map(|h| h.subscribers.len())
            .unwrap_or(0)
    }
}

impl Default for GitWatcherRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git_init(dir: &Path) {
        Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(dir)
            .status()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .status()
            .unwrap();
    }

    #[tokio::test]
    async fn plain_folder_subscription_does_not_start_a_git_watcher() {
        let dir = tempfile::tempdir().unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
        for sql in [
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, path TEXT)",
            "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER, type TEXT, title TEXT)",
            "CREATE TABLE feature_settings (feature_id INTEGER, key TEXT, value TEXT)",
            "INSERT INTO features VALUES (1, 1, 'ws-session', 'Plain project')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO projects VALUES (1, ?)")
            .bind(dir.path().to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let (tx, _rx) = mpsc::unbounded_channel::<Message>();
        let snapshot = state
            .git_watcher
            .subscribe(&state, 1, tx.clone())
            .await
            .unwrap();
        assert_eq!(snapshot.current_branch, "");
        assert_eq!(state.git_watcher.handle_count().await, 0);

        // Detection is not cached: initializing Git later enables the watcher
        // on the next subscription without recreating the project.
        git_init(dir.path());
        state.git_watcher.subscribe(&state, 1, tx).await.unwrap();
        assert_eq!(state.git_watcher.handle_count().await, 1);
        state.git_watcher.shutdown().await;
    }

    #[tokio::test]
    async fn subscribe_unsubscribe_refcount_transitions() {
        let dir = tempfile::tempdir().unwrap();
        git_init(dir.path());

        let registry = GitWatcherRegistry::new();
        let canonical = std::fs::canonicalize(dir.path()).unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .unwrap();
        let state = AppState::with_pool(pool);
        let handle = spawn_handle(registry.inner.clone(), canonical.clone(), state).unwrap();
        {
            let mut inner = registry.inner.lock().await;
            inner.handles.insert(canonical.clone(), handle);
        }

        let (tx1, _rx1) = mpsc::unbounded_channel::<Message>();
        let (tx2, _rx2) = mpsc::unbounded_channel::<Message>();
        {
            let mut inner = registry.inner.lock().await;
            let h = inner.handles.get_mut(&canonical).unwrap();
            h.subscribers.push(Subscriber {
                feature_id: 1,
                sender: tx1,
            });
            h.subscribers.push(Subscriber {
                feature_id: 2,
                sender: tx2,
            });
        }
        assert_eq!(registry.subscriber_count(&canonical).await, 2);

        registry.unsubscribe(1).await;
        assert_eq!(registry.subscriber_count(&canonical).await, 1);

        registry.unsubscribe(2).await;
        assert_eq!(registry.handle_count().await, 1);
        registry.shutdown().await;
        assert_eq!(registry.handle_count().await, 0);
    }
}
