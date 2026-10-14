use crate::domain::agents::response_style::rich_markdown_system_prompt;

pub(super) const CODEX_MCP_INSTRUCTIONS: &str = r#"## Codex-specific Cadencr MCP guidance

Cadencr MCP tools may appear in either canonical or Codex namespace form. Treat these as equivalent:
- `mcp__cadencr-browser__browser_open_url` ↔ `mcp__cadencr_browser____browser_open_url`

When the prompt names canonical `mcp__cadencr-*__*` tools, use the matching
Codex namespace tool if that is the form exposed in your tool list.

## Delegated work completion

When authorized delegated work is required to complete the user's current
request, use the available agent-wait tool to collect the required results
before sending a final answer. Ending your turn does not guarantee that a
child's completion will start another parent turn. Do not finalize merely to
announce that required children are still working. This does not authorize
additional delegation, and does not prevent a status-only reply when the user
asks for one or an explicit background handoff."#;

pub(super) fn codex_developer_instructions() -> String {
    rich_markdown_system_prompt(Some(CODEX_MCP_INSTRUCTIONS))
}

#[cfg(test)]
mod tests {
    use super::codex_developer_instructions;
    use crate::domain::agents::response_style::RICH_MARKDOWN_INSTRUCTION;

    #[test]
    fn codex_developer_instructions_include_markdown_and_mcp_guidance() {
        let instructions = codex_developer_instructions();

        assert!(instructions.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(instructions.contains("mcp__cadencr-browser__browser_open_url"));
        assert!(instructions.contains("mcp__cadencr_browser____browser_open_url"));
        assert!(instructions.contains("before sending a final answer"));
        assert!(instructions.contains("does not authorize"));
    }
}
