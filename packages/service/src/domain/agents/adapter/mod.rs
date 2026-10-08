mod adapter_defaults;
mod adapter_trait;
mod branching;
mod config;
mod error;
mod event;
mod event_types;
mod permission;
mod session;
mod session_config;
mod tool_input;
mod user_shell;

pub use adapter_trait::AgentRuntimeAdapter;
pub use branching::{BranchContext, BranchError, BranchResult, SessionBranching};
pub use config::{
    access_mode_wire, parse_access_mode_wire, static_config_paths, ResolvedRuntimeProfile,
    RuntimeAccessMode, RuntimeConfigOverrides, RuntimeEffectiveConfig, RuntimeMcpServerConfig,
    RuntimeMcpServerStatus, RuntimePermissionMode, RuntimeSpawnConfig, RuntimeTokenUsage,
    RuntimeTokenUsageEntry, RuntimeUsage,
};
pub use error::RuntimeError;
pub use event::RuntimeStreamScope;
pub use event_types::{
    BackgroundAgentSignal, RuntimeAssistantMessage, RuntimeCompactMetadata, RuntimeContentBlock,
    RuntimeContentDelta, RuntimeEvent, RuntimeEventKind, RuntimeEventMetadata, RuntimeInitEvent,
    RuntimeResultError, RuntimeStreamEvent, RuntimeStreamStatus, RuntimeTurnStartedSource,
    RuntimeUserContentBlock, RuntimeUserMessage,
};
pub use permission::{
    RuntimeCompactionStrategy, RuntimePermissionDecision, RuntimePermissionOption,
    RuntimePermissionRequest, RuntimePermissionResponse, RuntimePermissionResponseKind,
    RuntimePermissionUpdate, RuntimePromptCommandPlacement, RuntimePromptCommandPolicy,
    RuntimeSkillReferenceTrigger, RuntimeSlashCommand, RuntimeSlashCommandKind,
    RuntimeToolPermissionRequest, RuntimeToolPermissionResult,
};
#[cfg(test)]
pub(crate) use session::test_support::DummySession;
pub use session::{
    AgentRuntimeSession, RuntimeMessageRx, RuntimeSessionHandle, RuntimeSessionWeakHandle,
    RuntimeToolPermissionHandler,
};
pub use session_config::{
    RuntimeSessionConfigChoices, RuntimeSessionConfigKind, RuntimeSessionConfigOption,
    RuntimeSessionConfigSelectGroup, RuntimeSessionConfigSelectOption,
    RuntimeSessionConfigSnapshot, RuntimeSessionConfigValue,
};
pub(crate) use tool_input::{is_file_change_tool_name, RuntimeToolInputBuffer};
pub use user_shell::RuntimeUserShellStrategy;
