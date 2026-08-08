use std::ffi::OsString;
use std::time::Duration;

use tokio::process::Command;

use crate::{resolve_binary, SdkError};

const MODELS_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq, bon::Builder)]
#[builder(on(String, into))]
pub struct CursorModel {
    pub id: String,
    pub label: String,
    #[builder(default)]
    pub is_current: bool,
}

pub async fn list_models_from_cli() -> Result<Vec<CursorModel>, SdkError> {
    let binary = resolve_binary().await?;
    let mut command =
        cli_discovery::login_shell_exec_command(binary.as_os_str(), [OsString::from("models")]);
    list_models_with_command(&mut command).await
}

async fn list_models_with_command(command: &mut Command) -> Result<Vec<CursorModel>, SdkError> {
    let output = tokio::time::timeout(MODELS_TIMEOUT, command.output())
        .await
        .map_err(|_| SdkError::Timeout("agent models"))??;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(SdkError::Process(if stderr.is_empty() {
            format!("agent models exited with {}", output.status)
        } else {
            stderr
        }));
    }
    let models = parse_models_output(&String::from_utf8_lossy(&output.stdout));
    if models.is_empty() {
        return Err(SdkError::Process(
            "agent models returned no parseable models".to_string(),
        ));
    }
    Ok(models)
}

/// Parse Cursor's account-scoped model list. Current builds print one entry
/// per line as `<id> - <label>` and suffix the selected entry with `(current)`.
/// Unknown/noise lines are ignored so additions around the table remain
/// backward-compatible.
pub fn parse_models_output(output: &str) -> Vec<CursorModel> {
    output
        .lines()
        .filter_map(parse_model_line)
        .collect::<Vec<_>>()
}

fn parse_model_line(line: &str) -> Option<CursorModel> {
    let clean = strip_ansi(line);
    let (raw_id, raw_label) = clean.trim().split_once(" - ")?;
    let id = raw_id
        .trim()
        .trim_start_matches(['*', '>', '-', '•'])
        .trim();
    if id.is_empty() || id.chars().any(char::is_whitespace) {
        return None;
    }
    let is_current = raw_label.contains("(current)");
    let label = raw_label.replace("(current)", "").trim().to_string();
    if label.is_empty() {
        return None;
    }
    Some(
        CursorModel::builder()
            .id(id)
            .label(label)
            .is_current(is_current)
            .build(),
    )
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            output.push(ch);
            continue;
        }
        if chars.next() != Some('[') {
            continue;
        }
        for code in chars.by_ref() {
            if code.is_ascii_alphabetic() {
                break;
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{parse_models_output, CursorModel};

    #[test]
    fn parses_cursor_model_table_and_current_marker() {
        let models = parse_models_output(
            "auto - Auto  (current)\ncomposer-2-fast - Composer 2 Fast\ngpt-5.3-codex-high - GPT-5.3 Codex High\n",
        );
        assert_eq!(
            models,
            vec![
                CursorModel::builder()
                    .id("auto")
                    .label("Auto")
                    .is_current(true)
                    .build(),
                CursorModel::builder()
                    .id("composer-2-fast")
                    .label("Composer 2 Fast")
                    .build(),
                CursorModel::builder()
                    .id("gpt-5.3-codex-high")
                    .label("GPT-5.3 Codex High")
                    .build(),
            ]
        );
    }

    #[test]
    fn ignores_headers_and_strips_ansi() {
        let models = parse_models_output(
            "Available models:\n\u{1b}[32m> auto - Auto (current)\u{1b}[0m\nnot a model\n",
        );
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "auto");
        assert_eq!(models[0].label, "Auto");
    }
}
