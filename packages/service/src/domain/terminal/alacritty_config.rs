//! Reads the user's `~/.config/alacritty/alacritty.toml` for the terminal
//! panel's font, colors, cursor style, and scrollback depth. Read-only —
//! this module never writes to the file. A missing file is normal (most
//! users don't have one) and produces Alacritty's own documented defaults,
//! field by field; a *malformed* file is a real condition the caller should
//! be able to surface, since it means the user's real settings are silently
//! not being honored.

use std::path::PathBuf;

use serde::Deserialize;

/// Alacritty's own documented default: `font.size`.
const DEFAULT_FONT_SIZE: f64 = 11.25;
/// Alacritty's own documented default: `scrolling.history`.
const DEFAULT_SCROLLBACK_HISTORY: u32 = 10_000;
/// Alacritty's own documented default: `cursor.style.shape`.
const DEFAULT_CURSOR_SHAPE: &str = "Block";
/// Alacritty's own documented default: `cursor.style.blinking`.
const DEFAULT_CURSOR_BLINKING: &str = "Off";

#[derive(Debug, Deserialize, PartialEq)]
#[serde(default)]
pub struct AlacrittyConfig {
    pub font: FontConfig,
    pub colors: ColorsConfig,
    pub cursor: CursorConfig,
    pub scrolling: ScrollingConfig,
}

impl Default for AlacrittyConfig {
    fn default() -> Self {
        Self {
            font: FontConfig::default(),
            colors: ColorsConfig::default(),
            cursor: CursorConfig::default(),
            scrolling: ScrollingConfig::default(),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct FontFace {
    pub family: Option<String>,
    pub style: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(default)]
pub struct FontConfig {
    /// Only `[font.normal]` is parsed — see this task's "Technical
    /// constraint" for why bold/italic/bold_italic are out of scope.
    pub normal: FontFace,
    pub size: f64,
}

impl Default for FontConfig {
    fn default() -> Self {
        Self {
            normal: FontFace::default(),
            size: DEFAULT_FONT_SIZE,
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct PrimaryColors {
    pub foreground: Option<String>,
    pub background: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct CursorColors {
    /// Verbatim from the file: either a hex color or the sentinel strings
    /// `"CellBackground"`/`"CellForeground"`. Not validated or resolved
    /// here — that's the consumer's job (Plan 3).
    pub text: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Clone)]
pub struct AnsiPalette {
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
}

#[derive(Debug, Deserialize, PartialEq, Default)]
#[serde(default)]
pub struct ColorsConfig {
    pub primary: PrimaryColors,
    pub cursor: CursorColors,
    /// `None` when the user's file doesn't override the 8 ANSI colors at
    /// all — unlike the other fields here, there's no single sensible
    /// "default 8-color palette" to fill in at this layer; the consumer
    /// (Plan 3) falls back to Cadencr's own bundled theme for this field.
    pub normal: Option<AnsiPalette>,
    pub bright: Option<AnsiPalette>,
}

#[derive(Debug, Deserialize, PartialEq, Clone)]
#[serde(default)]
pub struct CursorStyle {
    pub shape: String,
    pub blinking: String,
}

impl Default for CursorStyle {
    fn default() -> Self {
        Self {
            shape: DEFAULT_CURSOR_SHAPE.to_string(),
            blinking: DEFAULT_CURSOR_BLINKING.to_string(),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(default)]
pub struct CursorConfig {
    pub style: CursorStyle,
}

impl Default for CursorConfig {
    fn default() -> Self {
        Self {
            style: CursorStyle::default(),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(default)]
pub struct ScrollingConfig {
    pub history: u32,
}

impl Default for ScrollingConfig {
    fn default() -> Self {
        Self {
            history: DEFAULT_SCROLLBACK_HISTORY,
        }
    }
}

/// Default path: `~/.config/alacritty/alacritty.toml`. `None` only when the
/// home directory itself can't be resolved (no `$HOME`, no passwd entry —
/// see `dirs::home_dir()`'s own doc comment for when that happens).
///
/// `#[allow(dead_code)]`: nothing in the crate calls this yet -- Task 2
/// wires it into a route. Remove the attribute there; leaving it after
/// Task 2 lands would mask a real future dead-code regression.
#[allow(dead_code)]
pub fn default_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".config").join("alacritty").join("alacritty.toml"))
}

/// Parse `path`. Returns `Ok(None)` when the file does not exist — that's
/// the common case (most users don't have this file) and is not an error.
/// Returns `Err` only when the file exists but fails to parse, since that
/// means the user's real settings are silently not being honored.
///
/// `#[allow(dead_code)]`: same as `default_config_path` above — Task 2
/// consumes this and removes the attribute.
#[allow(dead_code)]
pub fn parse_alacritty_config(path: &std::path::Path) -> Result<Option<AlacrittyConfig>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("failed to read {}: {e}", path.display())),
    };
    toml::from_str(&raw)
        .map(Some)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_temp_toml(contents: &str) -> tempfile::TempPath {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut file, contents.as_bytes()).unwrap();
        file.into_temp_path()
    }

    #[test]
    fn missing_file_is_not_an_error() {
        let path = std::env::temp_dir().join("definitely-does-not-exist-alacritty.toml");
        assert_eq!(parse_alacritty_config(&path), Ok(None));
    }

    #[test]
    fn malformed_file_is_an_error_not_a_panic() {
        let path = write_temp_toml("this is not [ valid");
        let result = parse_alacritty_config(&path);
        assert!(result.is_err(), "expected an error, got {result:?}");
    }

    #[test]
    fn empty_file_gets_alacrittys_real_documented_defaults() {
        let path = write_temp_toml("");
        let config = parse_alacritty_config(&path).unwrap().unwrap();
        assert_eq!(config.scrolling.history, 10_000);
        assert_eq!(config.cursor.style.shape, "Block");
        assert_eq!(config.cursor.style.blinking, "Off");
        assert_eq!(config.font.size, 11.25);
        assert_eq!(config.font.normal.family, None);
        assert_eq!(config.colors.normal, None);
    }

    #[test]
    fn partial_file_only_overrides_what_it_sets() {
        let path = write_temp_toml("[cursor.style]\nshape = \"Beam\"\n");
        let config = parse_alacritty_config(&path).unwrap().unwrap();
        assert_eq!(config.cursor.style.shape, "Beam");
        // Untouched by the file — still Alacritty's documented default.
        assert_eq!(config.cursor.style.blinking, "Off");
        assert_eq!(config.scrolling.history, 10_000);
    }

    #[test]
    fn full_file_is_parsed_field_for_field() {
        // `r##"..."##`, not `r#"..."#`: the content contains `"#` sequences
        // (every `"#hexcolor"` value), which would otherwise close a
        // single-hash raw string early -- caught by actually compiling this
        // test while writing the plan, not by inspection.
        let path = write_temp_toml(
            r##"
[font]
size = 15

[font.normal]
family = "Iosevka Nerd Font Mono"
style = "Light"

[colors.primary]
foreground = "#cdd6f4"
background = "#1e1e2e"

[colors.cursor]
text = "#1e1e2e"
cursor = "#f5e0dc"

[colors.normal]
black = "#45475a"
red = "#f38ba8"
green = "#a6e3a1"
yellow = "#f9e2af"
blue = "#89b4fa"
magenta = "#f5c2e7"
cyan = "#94e2d5"
white = "#bac2de"

[colors.bright]
black = "#585b70"
red = "#f38ba8"
green = "#a6e3a1"
yellow = "#f9e2af"
blue = "#89b4fa"
magenta = "#f5c2e7"
cyan = "#94e2d5"
white = "#a6adc8"

[scrolling]
history = 5000
"##,
        );
        let config = parse_alacritty_config(&path).unwrap().unwrap();
        assert_eq!(config.font.size, 15.0);
        assert_eq!(config.font.normal.family.as_deref(), Some("Iosevka Nerd Font Mono"));
        assert_eq!(config.colors.primary.background.as_deref(), Some("#1e1e2e"));
        assert_eq!(config.colors.cursor.cursor.as_deref(), Some("#f5e0dc"));
        assert_eq!(config.colors.normal.unwrap().red, "#f38ba8");
        assert_eq!(config.scrolling.history, 5000);
        // Not set in the file -- still the real default, not zeroed.
        assert_eq!(config.cursor.style.shape, "Block");
    }
}
