use std::collections::HashMap;

use crate::app_state::AppState;
use crate::domain::terminal::activity::live_shell_pids_by_feature;
use crate::error::AppError;

use super::attribution::{attribute, resolve, unresolved_pids, ProcessRoots};
use super::models::{FeaturePorts, PortSource};
use super::repository;
use super::scan;

/// Ports currently held by every feature's own processes.
pub async fn feature_ports(state: &AppState) -> Result<Vec<FeaturePorts>, AppError> {
    state.port_scan.get_or_refresh(|| scan_now(state)).await
}

async fn scan_now(state: &AppState) -> Result<Vec<FeaturePorts>, AppError> {
    let service_pid = std::process::id() as i32;
    let (sockets, parents) = tokio::try_join!(scan::listening_sockets(), scan::parent_map())
        .map_err(|error| {
            AppError::Internal(format!("Failed to inspect listening processes: {error}"))
        })?;
    if sockets.is_empty() {
        return Ok(Vec::new());
    }

    let roots = process_roots(state).await;
    let resolved = resolve(&sockets, &parents, &roots, service_pid);

    // Only sockets no live terminal or agent explains need a directory, and the
    // worktree list is worth loading only if there is something to match it
    // against — the common case is that ancestry has already answered.
    let pending = unresolved_pids(&resolved);
    if pending.is_empty() {
        return Ok(attribute(resolved, &HashMap::new(), &[]));
    }
    let feature_dirs = repository::unambiguous_worktree_dirs(&state.read_pool).await?;
    if feature_dirs.is_empty() {
        return Ok(attribute(resolved, &HashMap::new(), &[]));
    }
    let cwds = scan::cwd_map(&pending).await.map_err(|error| {
        AppError::Internal(format!("Failed to resolve process directories: {error}"))
    })?;

    Ok(attribute(resolved, &cwds, &feature_dirs))
}

/// Every pid that names a feature outright. Terminals are registered first so a
/// shell keeps its own feature even when an agent started it — the terminal is
/// the more specific claim.
async fn process_roots(state: &AppState) -> ProcessRoots {
    let mut roots: ProcessRoots = state
        .active_turns
        .agent_process_owners()
        .await
        .into_iter()
        .map(|(pid, feature_id)| (pid, (feature_id, PortSource::Agent)))
        .collect();
    for (pid, feature_id) in live_shell_pids_by_feature(&state.pty_manager) {
        roots.insert(pid, (feature_id, PortSource::Terminal));
    }
    roots
}
