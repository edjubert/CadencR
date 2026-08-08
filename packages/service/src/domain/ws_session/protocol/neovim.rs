use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// --- Neovim domain payloads (client ↔ server) ---

/// Client → Server: key events captured from the neovim editor.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NeovimKeyInputPayload {
    pub file_path: String,
    pub keys: String,
}

/// Server → Client: cursor position update from neovim.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NeovimCursorMovedPayload {
    pub file_path: String,
    pub line: u32,
    pub col: u32,
}

/// Server → Client: mode change (e.g. "normal", "insert", "visual") from neovim.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NeovimModeChangedPayload {
    pub file_path: String,
    pub mode: String,
}

/// Server → Client: buffer lines changed event from neovim.
/// `lastline` of -1 means "end of buffer", matching `nvim_buf_lines_event`'s own convention.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct NeovimBufferLinesChangedPayload {
    pub file_path: String,
    pub firstline: u32,
    pub lastline: i32,
    pub lines: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neovim_key_input_payload_round_trips_through_json() {
        let payload = NeovimKeyInputPayload {
            file_path: "src/main.rs".into(),
            keys: "dd".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: NeovimKeyInputPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.file_path, "src/main.rs");
        assert_eq!(parsed.keys, "dd");
    }
}
