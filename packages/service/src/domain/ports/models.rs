use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How a listening process was traced back to its feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PortSource {
    /// Descends from the shell of one of the feature's terminals.
    Terminal,
    /// Descends from the feature's live agent process.
    Agent,
    /// Neither ancestry applies — the process is simply running inside the
    /// feature's worktree. This is what a server outlives its agent as, since
    /// the agent CLI exits at the end of the session and leaves the server
    /// reparented to init.
    Workspace,
}

/// A single TCP port held open by one of a feature's processes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AllocatedPort {
    pub port: u16,
    pub pid: i32,
    /// Executable name as reported by the OS (`node`, `vite`, `python3`, …).
    pub process: String,
    pub source: PortSource,
}

/// Ports currently allocated by one feature, ordered ascending by port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct FeaturePorts {
    pub feature_id: i64,
    pub ports: Vec<AllocatedPort>,
}
