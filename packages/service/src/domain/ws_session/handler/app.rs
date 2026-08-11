use axum::extract::ws::Message;
use tracing::{debug, warn};

use super::super::protocol::WsEnvelope;
use super::WsSender;
use crate::app_state::AppState;

/// Handle `app` domain actions (cross-feature, app-level concerns).
pub(super) async fn handle_app_action(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    match envelope.action.as_str() {
        "subscribe.session_status" => {
            handle_subscribe_session_status(envelope, sender, app_state).await
        }
        "subscribe.feature_events" => handle_subscribe_feature_events(sender, app_state).await,
        "subscribe.settings_events" => handle_subscribe_settings_events(sender, app_state).await,
        "subscribe.alacritty_config_events" => {
            handle_subscribe_alacritty_config_events(sender, app_state).await
        }
        "subscribe.forge_status" => {
            super::app_forge::subscribe_forge_status(envelope, sender, app_state).await
        }
        "forge_visibility" => {
            super::app_forge::update_forge_visibility(envelope, sender, app_state).await
        }
        "subscribe.remote_events" => handle_subscribe_remote_events(sender, app_state).await,
        "subscribe.file_watcher" => {
            handle_subscribe_file_watcher(envelope, sender, app_state).await
        }
        "subscribe.git_status" => handle_subscribe_git_status(envelope, sender, app_state).await,
        "unsubscribe.git_status" => {
            handle_unsubscribe_git_status(envelope, sender, app_state).await
        }
        unknown => {
            debug!(action = %unknown, "unknown app action, ignoring");
        }
    }
}

/// Subscribe the client to real-time `git.status` envelopes for a feature's
/// worktree. Sends an initial snapshot synchronously (as the first
/// `git.status` event), then the watcher pushes updates whenever the worktree
/// changes.
async fn handle_subscribe_git_status(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let feature_id = match envelope.payload.get("feature_id").and_then(|v| v.as_i64()) {
        Some(id) => id,
        None => {
            super::send_error(sender, &envelope.id, "BAD_REQUEST", "missing feature_id");
            return;
        }
    };

    match app_state
        .git_watcher
        .subscribe(app_state, feature_id, sender.clone())
        .await
    {
        Ok(snapshot) => {
            let env = WsEnvelope::new(
                "git",
                "status",
                serde_json::to_value(&snapshot).unwrap_or_else(|_| serde_json::json!({})),
            );
            let _ = sender.send(Message::Text(String::from(env).into()));
        }
        Err(e) => {
            warn!(error = %e, feature_id, "failed to subscribe git watcher");
            super::send_error(sender, &envelope.id, "WATCHER_ERROR", &e.to_string());
        }
    }
}

/// Drop one feature's `git.status` subscription on this connection.
async fn handle_unsubscribe_git_status(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let feature_id = envelope.payload.get("feature_id").and_then(|v| v.as_i64());
    let Some(feature_id) = feature_id else {
        super::send_error(sender, &envelope.id, "BAD_REQUEST", "missing feature_id");
        return;
    };
    // Drop only the (feature_id, sender) pair — multiple WS sessions may
    // watch the same feature_id, and a global `unsubscribe(feature_id)`
    // would kick all of them.
    app_state
        .git_watcher
        .unsubscribe_one(feature_id, sender)
        .await;
}

/// Build the per-session status snapshot and enrich each running entry with
/// the server-stamped turn start from the active-turn registry, so a
/// (re)connecting client anchors its elapsed timer to the same instant the
/// host did. The DB has no per-turn start column, so this is the only place
/// the snapshot picks the timestamp up.
async fn session_status_snapshot_with_timers(
    app_state: &AppState,
) -> std::collections::HashMap<String, crate::domain::sessions::models::SessionStatusSnapshotEntry>
{
    let mut states =
        crate::domain::sessions::repository::get_session_status_snapshot(&app_state.read_pool)
            .await
            .unwrap_or_default();
    for entry in states.values_mut() {
        if entry.status == crate::domain::session_status::AgentStatus::Agent {
            entry.turn_started_at_ms = app_state.active_turns.started_at(entry.session_id).await;
        }
    }
    states
}

/// Subscribe the client to real-time per-session status updates.
/// Sends an initial snapshot keyed by `session_id`, then streams
/// incremental [`SessionStatusEvent`]s.
///
/// Every envelope carries a monotonic `seq` (stamped at send time by
/// `SessionStatusBroadcaster`). Snapshots include the current counter so the
/// frontend can reject any snapshot whose seq is older than an update
/// already applied for a session — that's how we close the lag-recovery
/// race where a snapshot would otherwise wipe a fresh live update.
async fn handle_subscribe_session_status(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    // Subscribe FIRST so any update emitted between snapshot read and
    // subscribe is queued in the broadcast buffer rather than lost.
    let mut rx = app_state.session_status_tx.subscribe();

    // Read snapshot AFTER subscribing. Seq is read first so the snapshot's
    // stamped seq is a lower bound: every event with seq > snapshot.seq is
    // guaranteed to flow through `rx` (either because it was emitted after
    // subscribe, or because it was buffered before this line).
    let seq = app_state.session_status_tx.current_seq();
    let states = session_status_snapshot_with_timers(app_state).await;

    let snapshot = WsEnvelope::reply(
        &envelope.id,
        "app",
        "session_status.snapshot",
        serde_json::json!({ "states": states, "seq": seq }),
    );
    let _ = sender.send(Message::Text(String::from(snapshot).into()));

    let sender = sender.clone();
    let app_state = app_state.clone();
    let broadcaster = app_state.session_status_tx.clone();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "app",
                        "session_status.update",
                        serde_json::to_value(&event).unwrap_or_else(|_| serde_json::json!({})),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        // WS connection closed
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(
                        skipped = n,
                        "session status broadcast lagged, sending fresh snapshot",
                    );
                    let states = session_status_snapshot_with_timers(&app_state).await;
                    let seq = broadcaster.current_seq();
                    let snapshot = WsEnvelope::new(
                        "app",
                        "session_status.snapshot",
                        serde_json::json!({ "states": states, "seq": seq }),
                    );
                    if sender
                        .send(Message::Text(String::from(snapshot).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });
}

/// Subscribe the client to global feature-lifecycle events. There is no
/// snapshot — the client already has the feature list via REST; each event is
/// just a cue to refetch. Forwards every [`FeatureEvent`] as an
/// `app/feature_event` envelope until the socket closes.
async fn handle_subscribe_feature_events(sender: &WsSender, app_state: &AppState) {
    let mut rx = app_state.feature_events_tx.subscribe();
    let sender = sender.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "app",
                        "feature_event",
                        serde_json::to_value(&event).unwrap_or_else(|_| serde_json::json!({})),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                // A lagged client just needs to refetch — send a bare event so
                // it invalidates regardless of which specific changes it missed.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let update = WsEnvelope::new("app", "feature_event", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Subscribe the client to settings-file change events. No snapshot — each
/// event is a cue to refetch settings (the file changed on disk, via our own
/// write or an external editor). Forwards every [`SettingsChangeEvent`] as an
/// `app/settings_event` envelope until the socket closes.
async fn handle_subscribe_settings_events(sender: &WsSender, app_state: &AppState) {
    let mut rx = app_state.settings_events_tx.subscribe();
    let sender = sender.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "app",
                        "settings_event",
                        serde_json::to_value(&event).unwrap_or_else(|_| serde_json::json!({})),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                // A lagged client just refetches — send a bare event.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let update = WsEnvelope::new("app", "settings_event", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Subscribe the client to `alacritty.toml` change events. No snapshot — each
/// event is a cue to re-fetch `GET /api/terminal/alacritty-config`. Forwards
/// every [`AlacrittyConfigChangedEvent`] as an `app/alacritty_config_event`
/// envelope until the socket closes.
async fn handle_subscribe_alacritty_config_events(sender: &WsSender, app_state: &AppState) {
    let mut rx = app_state.alacritty_config_events_tx.subscribe();
    let sender = sender.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(_event) => {
                    let update =
                        WsEnvelope::new("app", "alacritty_config_event", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                // A lagged client just refetches — send a bare event.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let update =
                        WsEnvelope::new("app", "alacritty_config_event", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Subscribe the client to remote device-connection events. Like
/// `feature_events`, there is no snapshot — each event is a one-shot cue to
/// show a "device connected" toast on the host. Only the host (loopback) UI
/// subscribes; remote browsers deliberately don't, so a device never toasts
/// for its own connection. Forwards every [`RemoteConnectedEvent`] as an
/// `app/remote_connected` envelope until the socket closes.
async fn handle_subscribe_remote_events(sender: &WsSender, app_state: &AppState) {
    let mut rx = app_state.remote_events_tx.subscribe();
    let sender = sender.clone();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "app",
                        "remote_connected",
                        serde_json::to_value(&event).unwrap_or_else(|_| serde_json::json!({})),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                // A missed event just means a missed toast — skip it, don't
                // synthesize a bogus connection.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Subscribe the client to file-system change events for an editor root.
/// The client supplies database ids, never a filesystem path; the backend
/// resolves and validates the authoritative project/worktree root.
async fn handle_subscribe_file_watcher(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let project_id = match envelope
        .payload
        .get("project_id")
        .and_then(|value| value.as_i64())
    {
        Some(id) => id,
        None => {
            super::send_error(sender, &envelope.id, "BAD_REQUEST", "missing project_id");
            return;
        }
    };
    let feature_id = envelope
        .payload
        .get("feature_id")
        .and_then(|value| value.as_i64());
    let project_path = match crate::domain::projects::service::resolve_feature_editor_root(
        &app_state.read_pool,
        project_id,
        feature_id,
    )
    .await
    {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(error) => {
            warn!(project_id, feature_id, error = %error, "invalid file watcher root");
            super::send_error(
                sender,
                &envelope.id,
                "BAD_REQUEST",
                "invalid project or feature",
            );
            return;
        }
    };

    // Start or replace the file watcher
    {
        let mut watcher = match app_state.file_watcher.lock() {
            Ok(watcher) => watcher,
            Err(poisoned) => {
                warn!("file watcher lock was poisoned; recovering state");
                app_state.file_watcher.clear_poison();
                poisoned.into_inner()
            }
        };
        if let Err(e) = watcher.start(&project_path, app_state.file_change_tx.clone()) {
            warn!(error = %e, "failed to start file watcher");
            super::send_error(sender, &envelope.id, "WATCHER_ERROR", &e);
            return;
        }
    }

    // ACK subscription
    let ack = WsEnvelope::reply(
        &envelope.id,
        "app",
        "file_watcher.subscribed",
        serde_json::json!({}),
    );
    let _ = sender.send(Message::Text(String::from(ack).into()));

    // Forward file change events to this WS client
    let mut rx = app_state.file_change_tx.subscribe();
    let sender = sender.clone();

    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    let update = WsEnvelope::new(
                        "editor",
                        "file_tree.changed",
                        serde_json::json!({ "project_path": event.project_path }),
                    );
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Just send one notification — the frontend will refetch anyway
                    let update =
                        WsEnvelope::new("editor", "file_tree.changed", serde_json::json!({}));
                    if sender
                        .send(Message::Text(String::from(update).into()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    });
}
