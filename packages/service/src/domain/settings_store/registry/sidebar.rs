//! Validators for the sidebar display options (density, row template, filter,
//! attention surfaces).
//! The value sets mirror `packages/desktop/src/lib/sidebar-config.ts`.

use super::{SettingSpec, ValueKind, BOOL};

/// Spec for a sidebar display key, or `None` for any other key.
pub(super) fn sidebar_display_spec(key: &str) -> Option<SettingSpec> {
    let spec = match key {
        "sidebar_density" => SettingSpec::new(
            ValueKind::Enum(&["compact", "comfortable", "spacious"]),
            Some("comfortable"),
        ),
        "sidebar_font_size" => {
            SettingSpec::new(ValueKind::Enum(&["12", "12.5", "13", "14"]), Some("12.5"))
        }
        "sidebar_title_lines" => {
            SettingSpec::new(ValueKind::Enum(&["one", "two", "hover"]), Some("one"))
        }
        "sidebar_title_source" => SettingSpec::new(
            ValueKind::Enum(&["title", "branch", "folder"]),
            Some("title"),
        ),
        "sidebar_row_status" => {
            SettingSpec::new(ValueKind::Enum(&["shape", "dot", "hidden"]), Some("shape"))
        }
        "sidebar_row_time" => SettingSpec::new(
            ValueKind::Enum(&["none", "relative", "absolute"]),
            Some("relative"),
        ),
        "sidebar_row_label" => {
            SettingSpec::new(ValueKind::Enum(&["chip", "dot", "hidden"]), Some("chip"))
        }
        "sidebar_row_provider" => SettingSpec::new(
            ValueKind::Enum(&["logo", "logo_model", "hidden"]),
            Some("logo"),
        ),
        "sidebar_project_badges" => {
            SettingSpec::new(ValueKind::Enum(&["count", "dot", "none"]), Some("count"))
        }
        "sidebar_dormant_after" => {
            SettingSpec::new(ValueKind::Enum(&["never", "3", "7", "14", "30"]), Some("7"))
        }
        "sidebar_reveal_active" => SettingSpec::new(
            ValueKind::Enum(&["scroll", "expand", "off"]),
            Some("scroll"),
        ),
        "sidebar_rail" => SettingSpec::new(
            ValueKind::Enum(&["projects", "conversations", "attention", "none"]),
            Some("projects"),
        ),
        "sidebar_recent_count" => SettingSpec::new(ValueKind::Enum(&["3", "5", "10"]), Some("5")),
        "sidebar_block_counts" => {
            SettingSpec::new(ValueKind::Enum(&["count", "dot", "none"]), Some("count"))
        }
        "sidebar_lens" => SettingSpec::new(
            ValueKind::Enum(&[
                "project", "status", "worktree", "provider", "label", "date", "flat",
            ]),
            Some("project"),
        ),
        "sidebar_conversation_sort" => SettingSpec::new(
            ValueKind::Enum(&["activity", "created", "title"]),
            Some("activity"),
        ),
        "sidebar_project_sort" => {
            SettingSpec::new(ValueKind::Enum(&["frozen", "live", "name"]), Some("frozen"))
        }
        "sidebar_row_preview" => {
            SettingSpec::new(ValueKind::Enum(&["none", "last_message"]), Some("none"))
        }
        "sidebar_gate_popover" => {
            SettingSpec::new(ValueKind::Enum(&["auto", "hover", "click"]), Some("auto"))
        }
        "sidebar_row_branch"
        | "sidebar_block_working"
        | "sidebar_block_recent"
        | "sidebar_auto_collapse"
        | "sidebar_row_todos"
        | "sidebar_compact_rows" => SettingSpec::new(BOOL, Some("false")),
        "sidebar_row_worktree_icon"
        | "sidebar_row_diff"
        | "sidebar_row_pr"
        | "sidebar_row_ports"
        | "sidebar_row_activity"
        | "sidebar_row_pending_request"
        | "sidebar_block_for_me"
        | "sidebar_hide_empty_blocks"
        | "sidebar_flash_on_change"
        | "sidebar_sticky_headers"
        | "sidebar_uniform_rows"
        | "sidebar_type_to_filter" => SettingSpec::new(BOOL, Some("true")),
        _ => return None,
    };
    Some(spec)
}

#[cfg(test)]
mod tests {
    use super::super::workspace_spec;
    use crate::domain::settings_allowlist::{is_workspace_key_allowed, SIDEBAR_DISPLAY_KEYS};

    #[test]
    fn every_sidebar_display_key_is_writable_and_validated() {
        for key in SIDEBAR_DISPLAY_KEYS {
            assert!(is_workspace_key_allowed(key), "{key} must be writable");
            let spec = workspace_spec(key).unwrap_or_else(|| panic!("{key} needs a spec"));
            let default = spec
                .default
                .unwrap_or_else(|| panic!("{key} needs a default"));
            assert!(spec.is_valid(default), "{key} default must validate");
        }
    }

    #[test]
    fn sidebar_enums_reject_unknown_values() {
        let density = workspace_spec("sidebar_density").unwrap();
        assert!(density.is_valid("compact"));
        assert!(!density.is_valid("cozy"));
        let font = workspace_spec("sidebar_font_size").unwrap();
        assert!(font.is_valid("12.5"));
        assert!(!font.is_valid("15"));
        let branch = workspace_spec("sidebar_row_branch").unwrap();
        assert_eq!(branch.default, Some("false"));
        let dormant = workspace_spec("sidebar_dormant_after").unwrap();
        assert!(dormant.is_valid("never"));
        assert!(!dormant.is_valid("5"));
        let rail = workspace_spec("sidebar_rail").unwrap();
        assert_eq!(rail.default, Some("projects"));
        assert!(!rail.is_valid("hidden"));
        let popover = workspace_spec("sidebar_gate_popover").unwrap();
        assert_eq!(popover.default, Some("auto"));
        assert!(!popover.is_valid("never"));
        let recent = workspace_spec("sidebar_recent_count").unwrap();
        assert!(recent.is_valid("10"));
        assert!(!recent.is_valid("7"));
        let auto_collapse = workspace_spec("sidebar_auto_collapse").unwrap();
        assert_eq!(auto_collapse.default, Some("false"));
        let lens = workspace_spec("sidebar_lens").unwrap();
        assert_eq!(lens.default, Some("project"));
        assert!(lens.is_valid("date"));
        assert!(!lens.is_valid("tree"));
        let project_sort = workspace_spec("sidebar_project_sort").unwrap();
        assert!(project_sort.is_valid("name"));
        assert!(!project_sort.is_valid("manual"));
        let preview = workspace_spec("sidebar_row_preview").unwrap();
        assert_eq!(preview.default, Some("none"));
        assert!(!preview.is_valid("summary"));
        assert_eq!(
            workspace_spec("sidebar_uniform_rows").unwrap().default,
            Some("true")
        );
        assert_eq!(
            workspace_spec("sidebar_compact_rows").unwrap().default,
            Some("false")
        );
    }
}
