//! Watches `~/.config/alacritty/alacritty.toml` plus every file its
//! `general.import` chain touches, and broadcasts a ping whenever any of
//! them changes. Read-only — this module never writes to the files.
//!
//! The import graph is not fixed at startup: every matching event both
//! triggers a client refetch and asks the subscription thread to re-resolve
//! the chain, so a newly added `general.import` becomes watched too, and a
//! chain that was invalid when the service started is picked up as soon as
//! the root becomes parseable again.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use serde::Serialize;
use tokio::sync::broadcast;
use tracing::{debug, warn};

use super::default_config_path;
use super::resolve::resolve_alacritty_config;

/// Emitted when the config chain changes on disk. Carries no data — the
/// client re-fetches `GET /api/terminal/alacritty-config` on receiving one,
/// the same "ping, then re-fetch" convention `SettingsChangeEvent` already
/// uses for the settings directory.
#[derive(Clone, Debug, Serialize)]
pub struct AlacrittyConfigChangedEvent {}

/// Which files trigger a refetch (exact paths, not bare file names) and
/// which directories are subscribed to get events for them.
#[derive(Debug, Default, Clone)]
struct WatchState {
    files: HashSet<PathBuf>,
    dirs: HashSet<PathBuf>,
}

impl WatchState {
    /// The exact chain files plus each file's parent directory. `config_path`
    /// is always included so an unresolvable chain degrades to watching the
    /// root alone and can recover on the next root edit. Each file is kept
    /// under BOTH its raw and its canonical form: backends like macOS
    /// FSEvents report events with the canonical path (e.g. `/private/var`
    /// instead of `/var`, or through a symlinked `~/.config`), while a
    /// symlinked import's own deletion event arrives under the raw symlink
    /// path — exact matching must accept both sides.
    fn from_touched(config_path: &Path, touched: Vec<PathBuf>) -> Self {
        let mut files = HashSet::from([config_path.to_path_buf(), normalize(config_path)]);
        let mut dirs = HashSet::from([config_path.parent().map(normalize).unwrap_or_default()]);
        for path in touched {
            if let Some(dir) = path.parent() {
                dirs.insert(normalize(dir));
            }
            files.insert(path.clone());
            files.insert(normalize(&path));
        }
        WatchState { files, dirs }
    }
}

/// Canonical form of `path`, or the path itself when it can't be resolved
/// (it may not exist yet — the state build tolerates that).
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

/// Re-resolve the chain and derive the new watch set. A resolution failure
/// (invalid chain, missing root) keeps only the root's own directory under
/// watch — the next edit there triggers another recompute, which is how an
/// initially broken chain recovers without a service restart.
fn recompute_state(config_path: &Path) -> WatchState {
    let touched = match resolve_alacritty_config(config_path) {
        Ok(Some((_, touched))) => touched,
        _ => Vec::new(),
    };
    WatchState::from_touched(config_path, touched)
}

/// Whether `path` is exactly one of the chain's own files — the root or one
/// of its imports, not some unrelated file that merely shares a name with
/// one of them (e.g. a `font.toml` in another watched directory). Both the
/// raw form and the canonical form are accepted: a deleted file can't be
/// canonicalized anymore, but the deletion event still deserves a reload.
fn is_watched_config_file(path: &Path, files: &HashSet<PathBuf>) -> bool {
    files.contains(path) || files.contains(&normalize(path))
}

/// Align the OS subscriptions with `next`: subscribe to newly needed
/// directories, unsubscribe from the ones no chain member lives in anymore.
fn apply_subscriptions(
    debouncer: &mut Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
    previous: &WatchState,
    next: &WatchState,
) {
    for dir in previous.dirs.difference(&next.dirs) {
        if let Err(e) = debouncer.watcher().unwatch(dir) {
            warn!(dir = %dir.display(), "failed to unwatch alacritty config dir: {e}");
        }
    }
    for dir in next.dirs.difference(&previous.dirs) {
        if let Err(e) = debouncer.watcher().watch(dir, RecursiveMode::NonRecursive) {
            warn!(dir = %dir.display(), "failed to watch alacritty config dir: {e}");
        }
    }
}

/// Watch the root config and every file its import chain touches, and
/// broadcast a ping on `tx` whenever any of them changes. Best-effort: a
/// failure is logged, never fatal — the config still loads once at startup
/// via the HTTP route, just without live external-edit refresh. No-ops
/// (does not start a watcher, does not warn) when the home directory can't
/// be resolved at all.
pub fn start_watcher(tx: broadcast::Sender<AlacrittyConfigChangedEvent>) {
    let Some(config_path) = default_config_path() else {
        return;
    };
    spawn_watcher(config_path, tx);
}

fn spawn_watcher(config_path: PathBuf, tx: broadcast::Sender<AlacrittyConfigChangedEvent>) {
    // Events arrive on notify's own thread; subscriptions must change from
    // event context, but watcher methods may not be called from there
    // safely. Instead, each matching event also signals this channel, and
    // the subscription thread below owns the debouncer and re-aligns the
    // watch set off the event path.
    let (recompute_tx, recompute_rx) = mpsc::channel::<()>();
    let state = Arc::new(Mutex::new(recompute_state(&config_path)));
    // The subscription thread pings clients again once it has aligned the
    // watch set, so an edit racing the new subscriptions (a change made to a
    // newly imported file before its directory was under watch) is still
    // picked up by the refetch instead of silently missed.
    let reload_tx = tx.clone();

    let event_files = Arc::clone(&state);
    let mut debouncer = match new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let events = match result {
                Ok(events) => events,
                Err(e) => {
                    warn!("alacritty config watcher error: {e:?}");
                    return;
                }
            };
            let files = event_files
                .lock()
                .expect("watch state poisoned")
                .files
                .clone();
            let changed = events
                .iter()
                .any(|e| is_watched_config_file(&e.path, &files));
            if changed {
                debug!("alacritty.toml change detected");
                let _ = tx.send(AlacrittyConfigChangedEvent {});
                // The edit may also have changed the import graph itself
                // (a `general.import` added or removed) — recompute it so
                // the new files become watched too.
                let _ = recompute_tx.send(());
            }
        },
    ) {
        Ok(debouncer) => debouncer,
        Err(e) => {
            warn!("failed to create alacritty config watcher: {e}");
            return;
        }
    };

    // Apply the initial subscriptions synchronously, before spawning the
    // recompute thread, so `start_watcher` returns with the chain already
    // under watch — an edit racing service startup is still caught.
    let current = state.lock().expect("watch state poisoned").clone();
    let initial = current.clone();
    apply_subscriptions(&mut debouncer, &WatchState::default(), &current);
    debug!(dirs = ?current.dirs, "alacritty config watcher started");

    let thread_state = Arc::clone(&state);
    if let Err(e) = std::thread::Builder::new()
        .name("alacritty-config-watch".to_string())
        .spawn(move || {
            // The thread owns the debouncer for the process lifetime (same
            // reasoning as the settings watcher's static): dropping it would
            // silently stop notifications. The keep-alive chain is circular
            // by design — the debouncer's callback holds `recompute_tx`,
            // which keeps this channel (and thus this thread and the
            // debouncer it owns) alive; no static is needed.
            //
            // Watching each directory (not the files themselves) survives
            // editors that save by replacing the file rather than writing
            // in place.
            let mut current = initial;
            while recompute_rx.recv() == Ok(()) {
                let next = recompute_state(&config_path);
                apply_subscriptions(&mut debouncer, &current, &next);
                *thread_state.lock().expect("watch state poisoned") = next.clone();
                debug!(
                    files = ?next.files,
                    "alacritty config watch set recomputed"
                );
                current = next;
                // Close the subscription-installation window: events for
                // the newly watched files couldn't fire before this point,
                // so clients get one more refetch now that they can.
                let _ = reload_tx.send(AlacrittyConfigChangedEvent {});
            }
        })
    {
        warn!("failed to spawn alacritty config watcher thread: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files_of(paths: &[&str]) -> HashSet<PathBuf> {
        paths.iter().map(PathBuf::from).collect()
    }

    #[test]
    fn matches_only_the_exact_config_chain_paths() {
        let files = files_of(&[
            "/home/user/.config/alacritty/alacritty.toml",
            "/home/user/.config/alacritty/themes/font.toml",
        ]);
        assert!(is_watched_config_file(
            Path::new("/home/user/.config/alacritty/alacritty.toml"),
            &files
        ));
        assert!(is_watched_config_file(
            Path::new("/home/user/.config/alacritty/themes/font.toml"),
            &files
        ));
        // An unrelated file that merely shares a basename with a chain file
        // must NOT match — the old basename-based check did.
        assert!(!is_watched_config_file(
            Path::new("/home/user/.config/alacritty/other-dir/font.toml"),
            &files
        ));
        assert!(!is_watched_config_file(
            Path::new("/home/user/.config/alacritty/alacritty.toml.swp"),
            &files
        ));
        assert!(!is_watched_config_file(
            Path::new("/home/user/.config/alacritty/themes/other.toml"),
            &files
        ));
    }

    #[test]
    fn watch_state_covers_each_files_directory_and_always_the_root() {
        let state = WatchState::from_touched(
            Path::new("/home/user/.config/alacritty/alacritty.toml"),
            vec![
                PathBuf::from("/home/user/.config/alacritty/themes/font.toml"),
                PathBuf::from("/home/user/.config/alacritty/alacritty.toml"),
            ],
        );
        assert_eq!(
            state.files,
            files_of(&[
                "/home/user/.config/alacritty/alacritty.toml",
                "/home/user/.config/alacritty/themes/font.toml",
            ])
        );
        assert_eq!(
            state.dirs,
            files_of(&[
                "/home/user/.config/alacritty",
                "/home/user/.config/alacritty/themes",
            ])
        );
    }

    #[test]
    fn empty_touched_still_watches_the_root_directory() {
        let state = WatchState::from_touched(
            Path::new("/home/user/.config/alacritty/alacritty.toml"),
            Vec::new(),
        );
        assert_eq!(
            state.files,
            files_of(&["/home/user/.config/alacritty/alacritty.toml"])
        );
        assert_eq!(state.dirs, files_of(&["/home/user/.config/alacritty"]));
    }

    #[test]
    fn recompute_picks_up_every_import_of_a_valid_chain() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("font.toml"),
            "[font.normal]\nfamily = \"Iosevka\"\n",
        )
        .unwrap();
        let root = dir.path().join("alacritty.toml");
        std::fs::write(
            &root,
            "general.import = [\"font.toml\"]\n[scrolling]\nhistory = 5000\n",
        )
        .unwrap();
        let state = recompute_state(&root);
        assert!(state.files.contains(&normalize(&root)));
        assert!(state
            .files
            .contains(&normalize(&dir.path().join("font.toml"))));
    }

    #[test]
    fn recompute_falls_back_to_the_root_on_an_invalid_chain() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("alacritty.toml");
        std::fs::write(&root, "general.import = [\"does-not-exist.toml\"]\n").unwrap();
        let state = recompute_state(&root);
        // The root stays under watch in both its raw and canonical forms.
        assert_eq!(
            state.files,
            files_of(&[root.to_str().unwrap(), normalize(&root).to_str().unwrap()])
        );
        // The root's directory stays subscribed, so fixing the root later
        // triggers another recompute — that's the recovery path.
        assert_eq!(
            state.dirs,
            files_of(&[normalize(dir.path()).to_str().unwrap()])
        );
    }

    /// Wait until the watcher broadcasts at least one event, polling instead
    /// of sleeping a fixed amount: real FS events + the 500ms debounce are
    /// asynchronous, and FSEvents needs a moment after stream start before
    /// it reports reliably.
    fn wait_for_event(rx: &mut broadcast::Receiver<AlacrittyConfigChangedEvent>) -> bool {
        use broadcast::error::TryRecvError;

        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        while std::time::Instant::now() < deadline {
            match rx.try_recv() {
                Ok(_) => return true,
                // Events occurred but the receiver fell behind: still a
                // change notification.
                Err(TryRecvError::Lagged(_)) => return true,
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Closed) => return false,
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    /// Write `contents` and wait for the resulting reload event, retrying a
    /// couple of times so a single missed FS event (FSEvents startup
    /// latency, a write racing the subscription thread) can't produce a
    /// false failure.
    fn write_and_expect_reload(
        rx: &mut broadcast::Receiver<AlacrittyConfigChangedEvent>,
        path: &Path,
        contents: &str,
    ) -> bool {
        for _ in 0..2 {
            std::fs::write(path, contents).unwrap();
            if wait_for_event(rx) {
                return true;
            }
        }
        false
    }

    /// Drain every event already delivered to `rx`, then wait out the
    /// debounce window so no further events can be in flight. Used between
    /// the two phases of the end-to-end test: the subscription thread also
    /// sends a follow-up reload ping once a new import is under watch, and
    /// phase two must not succeed on that leftover ping.
    fn drain_and_settle(rx: &mut broadcast::Receiver<AlacrittyConfigChangedEvent>) {
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
        std::thread::sleep(Duration::from_millis(300));
        while rx.try_recv().is_ok() {}
    }

    #[test]
    fn a_newly_added_import_becomes_watched_and_triggers_live_reload() {
        let dir = tempfile::tempdir().unwrap();
        let config_dir = dir.path().join("alacritty");
        let themes = config_dir.join("themes");
        std::fs::create_dir_all(&themes).unwrap();
        let root = config_dir.join("alacritty.toml");
        std::fs::write(&root, "[scrolling]\nhistory = 1000\n").unwrap();
        let import = themes.join("font.toml");
        std::fs::write(&import, "[font]\nsize = 14\n").unwrap();

        let (tx, _keep) = broadcast::channel(16);
        spawn_watcher(root.clone(), tx.clone());
        let mut rx = tx.subscribe();
        // Let the OS event stream settle before the first edit — FSEvents
        // can drop writes that race stream startup.
        std::thread::sleep(Duration::from_millis(500));

        // Add the import to the root: this must trigger a reload event for
        // clients AND extend the subscriptions to themes/.
        assert!(
            write_and_expect_reload(
                &mut rx,
                &root,
                "general.import = [\"themes/font.toml\"]\n[scrolling]\nhistory = 1000\n",
            ),
            "editing the root must trigger a reload event"
        );
        // Flush the follow-up ping the subscription thread sends once
        // themes/ is under watch, so phase two can only pass on a real
        // event for the imported file itself.
        drain_and_settle(&mut rx);

        // Editing the newly imported file is the reviewer's exact scenario:
        // before the recompute fix, its directory was never subscribed, so
        // this edit triggered nothing and only a service restart helped.
        assert!(
            write_and_expect_reload(&mut rx, &import, "[font]\nsize = 18\n"),
            "editing a newly imported file must trigger a reload event"
        );
    }

    #[test]
    fn a_symlinked_import_is_matched_under_both_of_its_paths() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("theme-real.toml");
        std::fs::write(&target, "[colors.primary]\nbackground = \"#1e1e2e\"\n").unwrap();
        let link = dir.path().join("theme-link.toml");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let root = dir.path().join("alacritty.toml");
        std::fs::write(&root, "general.import = [\"theme-link.toml\"]\n").unwrap();

        let state = recompute_state(&root);
        // The raw symlink path must be watched too: its deletion event
        // arrives under that path, and once the link is gone it can no
        // longer be canonicalized to the target's path.
        assert!(state.files.contains(&link));
        assert!(state.files.contains(&normalize(&link)));
        assert!(state.files.contains(&normalize(&target)));
        assert!(is_watched_config_file(&link, &state.files));
        assert!(is_watched_config_file(&normalize(&target), &state.files));
    }
}
