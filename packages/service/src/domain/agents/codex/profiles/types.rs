use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodexProfile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_path: Option<PathBuf>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub env_unset: Vec<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema, PartialEq, Eq)]
#[schema(as = CodexProfileView)]
pub struct CodexProfileView {
    pub id: String,
    pub name: String,
    pub config_path: Option<String>,
    pub effective_home: Option<String>,
    pub env_keys: Vec<String>,
    pub env_unset: Vec<String>,
    pub revision: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[schema(as = CodexProfileDraft)]
pub struct ProfileDraft {
    pub name: String,
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub env_unset: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
#[schema(as = CodexProfileUpdate)]
pub struct ProfileUpdate {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    #[schema(value_type = Option<String>)]
    pub config_path: NullableString,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub env_unset: Option<Vec<String>>,
    #[serde(default)]
    pub preserve_env_keys: Vec<String>,
}

#[derive(Debug, Clone, Default, ToSchema)]
pub enum NullableString {
    #[default]
    Missing,
    Null,
    Value(String),
}

impl<'de> Deserialize<'de> for NullableString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Ok(Option::<String>::deserialize(deserializer)?
            .map(Self::Value)
            .unwrap_or(Self::Null))
    }
}

#[derive(Debug, Clone, Serialize, ToSchema, PartialEq, Eq)]
#[schema(as = CodexValidationIssue)]
pub struct ValidationIssue {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[schema(as = CodexValidationResult)]
pub struct ValidationResult {
    pub valid: bool,
    /// `local_syntax` validates storage, env, path, and TOML only. Runtime
    /// resolution additionally calls Codex `config/read` in the launch cwd.
    pub validation_scope: String,
    pub codex_compatible: Option<bool>,
    pub errors: Vec<ValidationIssue>,
    pub effective_home: Option<String>,
    pub config_exists: bool,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedCodexProfile {
    pub profile: CodexProfile,
    pub effective_home: Option<PathBuf>,
    pub revision: String,
    pub config: Option<Value>,
}

pub(super) fn effective_home(profile: &CodexProfile) -> Option<PathBuf> {
    let configured = profile
        .config_path
        .as_deref()
        .and_then(Path::parent)
        .map(Path::to_path_buf);
    let home = configured
        .or_else(|| std::env::var_os("CODEX_HOME").map(PathBuf::from))
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))?;
    Some(std::fs::canonicalize(&home).unwrap_or(home))
}

pub fn default_home() -> Option<PathBuf> {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))?;
    Some(std::fs::canonicalize(&home).unwrap_or(home))
}

#[cfg(test)]
mod tests {
    use super::CodexProfile;
    use std::collections::HashMap;

    #[test]
    fn revision_is_stable_across_env_insertion_order() {
        let profile = |env| CodexProfile {
            id: "id".into(),
            name: "name".into(),
            config_path: None,
            env,
            env_unset: vec!["OLD_TOKEN".into()],
        };
        let left = profile(HashMap::from([
            ("A".into(), "1".into()),
            ("B".into(), "2".into()),
            ("C".into(), "3".into()),
        ]));
        let right = profile(HashMap::from([
            ("C".into(), "3".into()),
            ("A".into(), "1".into()),
            ("B".into(), "2".into()),
        ]));
        assert_eq!(
            super::super::read_config_and_revision(&left).unwrap().1,
            super::super::read_config_and_revision(&right).unwrap().1,
        );
    }
}
