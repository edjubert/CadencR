//! Turns browser keyboard events into the bytes a terminal application expects.

/// A `keydown` as the renderer observed it. `key` carries the DOM
/// `KeyboardEvent.key` value verbatim — no intermediate naming scheme.
#[derive(Debug, Clone)]
pub struct KeyInput {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    /// Whether the terminal has DECCKM (application cursor keys) enabled.
    /// Neovim turns it on, which changes what the arrow keys must emit.
    pub application_cursor: bool,
}

/// Encode a key press as PTY bytes.
///
/// Returns `None` when the key produces no terminal input — a bare modifier, an
/// unmapped key, or anything held with Meta (reserved for the host
/// application's own shortcuts). `None` is deliberately distinct from an empty
/// byte string, which would be indistinguishable from a key that legitimately
/// sends nothing.
pub fn encode_key(input: &KeyInput) -> Option<Vec<u8>> {
    // Meta belongs to Cadencr's shortcut system, not the terminal.
    if input.meta {
        return None;
    }

    let mut bytes = encode_unprefixed(input)?;

    // "Meta sends escape": Alt prefixes whatever the key would otherwise emit.
    if input.alt {
        let mut prefixed = Vec::with_capacity(bytes.len() + 1);
        prefixed.push(0x1B);
        prefixed.append(&mut bytes);
        return Some(prefixed);
    }

    Some(bytes)
}

fn encode_unprefixed(input: &KeyInput) -> Option<Vec<u8>> {
    if let Some(bytes) = encode_named_key(&input.key, input.application_cursor) {
        return Some(bytes);
    }

    let mut chars = input.key.chars();
    let ch = chars.next()?;
    // A multi-character `key` that isn't a known name is a modifier or a
    // composition state ("Shift", "Dead", …) — nothing to send.
    if chars.next().is_some() {
        return None;
    }

    if input.ctrl {
        return encode_control(ch).map(|byte| vec![byte]);
    }

    let mut buffer = [0_u8; 4];
    Some(ch.encode_utf8(&mut buffer).as_bytes().to_vec())
}

/// Ctrl+<key> in the C0 control range.
fn encode_control(ch: char) -> Option<u8> {
    match ch {
        'a'..='z' => Some(ch as u8 - b'a' + 1),
        'A'..='Z' => Some(ch as u8 - b'A' + 1),
        // The four non-letter control codes that see real use — Ctrl+[ in
        // particular is how many users leave insert mode.
        '[' => Some(0x1B),
        '\\' => Some(0x1C),
        ']' => Some(0x1D),
        '_' => Some(0x1F),
        ' ' => Some(0x00),
        _ => None,
    }
}

/// Keys the DOM names rather than describing by character.
fn encode_named_key(key: &str, application_cursor: bool) -> Option<Vec<u8>> {
    // In application cursor mode (DECCKM) the cursor keys switch from CSI to
    // SS3. Neovim enables it, so this is the common case, not an edge case.
    let cursor = |final_byte: u8| -> Vec<u8> {
        if application_cursor {
            vec![0x1B, b'O', final_byte]
        } else {
            vec![0x1B, b'[', final_byte]
        }
    };

    let bytes = match key {
        "Enter" => vec![0x0D],
        "Tab" => vec![0x09],
        "Escape" => vec![0x1B],
        // DEL, not BS: 0x08 would be read as Ctrl+H.
        "Backspace" => vec![0x7F],

        "ArrowUp" => cursor(b'A'),
        "ArrowDown" => cursor(b'B'),
        "ArrowRight" => cursor(b'C'),
        "ArrowLeft" => cursor(b'D'),
        "Home" => cursor(b'H'),
        "End" => cursor(b'F'),

        "PageUp" => b"\x1b[5~".to_vec(),
        "PageDown" => b"\x1b[6~".to_vec(),
        "Insert" => b"\x1b[2~".to_vec(),
        "Delete" => b"\x1b[3~".to_vec(),

        "F1" => b"\x1bOP".to_vec(),
        "F2" => b"\x1bOQ".to_vec(),
        "F3" => b"\x1bOR".to_vec(),
        "F4" => b"\x1bOS".to_vec(),
        "F5" => b"\x1b[15~".to_vec(),
        "F6" => b"\x1b[17~".to_vec(),
        "F7" => b"\x1b[18~".to_vec(),
        "F8" => b"\x1b[19~".to_vec(),
        "F9" => b"\x1b[20~".to_vec(),
        "F10" => b"\x1b[21~".to_vec(),
        "F11" => b"\x1b[23~".to_vec(),
        "F12" => b"\x1b[24~".to_vec(),

        _ => return None,
    };

    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(key: &str) -> Option<Vec<u8>> {
        encode_key(&KeyInput {
            key: key.to_string(),
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            application_cursor: false,
        })
    }

    fn with_ctrl(key: &str) -> Option<Vec<u8>> {
        encode_key(&KeyInput {
            key: key.to_string(),
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            application_cursor: false,
        })
    }

    #[test]
    fn printable_characters_encode_as_utf8() {
        assert_eq!(plain("a"), Some(b"a".to_vec()));
        assert_eq!(plain("Z"), Some(b"Z".to_vec()));
        assert_eq!(plain("é"), Some("é".as_bytes().to_vec()));
        assert_eq!(plain("🦀"), Some("🦀".as_bytes().to_vec()));
    }

    #[test]
    fn named_control_keys_encode_to_their_bytes() {
        assert_eq!(plain("Enter"), Some(vec![0x0D]));
        assert_eq!(plain("Tab"), Some(vec![0x09]));
        assert_eq!(plain("Escape"), Some(vec![0x1B]));
    }

    #[test]
    fn backspace_sends_del_not_backspace() {
        // 0x08 would be read as Ctrl+H; modern Unix terminals send DEL.
        assert_eq!(plain("Backspace"), Some(vec![0x7F]));
    }

    #[test]
    fn ctrl_letters_map_onto_the_control_range() {
        assert_eq!(with_ctrl("a"), Some(vec![0x01]));
        assert_eq!(with_ctrl("A"), Some(vec![0x01]));
        assert_eq!(with_ctrl("c"), Some(vec![0x03]));
        assert_eq!(with_ctrl("z"), Some(vec![0x1A]));
    }

    #[test]
    fn ctrl_bracket_is_escape() {
        // Ctrl+[ is how a great many Neovim users leave insert mode.
        assert_eq!(with_ctrl("["), Some(vec![0x1B]));
        assert_eq!(with_ctrl("\\"), Some(vec![0x1C]));
        assert_eq!(with_ctrl("]"), Some(vec![0x1D]));
        assert_eq!(with_ctrl("_"), Some(vec![0x1F]));
    }

    #[test]
    fn alt_prefixes_an_escape() {
        let encoded = encode_key(&KeyInput {
            key: "b".to_string(),
            ctrl: false,
            alt: true,
            shift: false,
            meta: false,
            application_cursor: false,
        });
        assert_eq!(encoded, Some(vec![0x1B, b'b']));
    }

    #[test]
    fn alt_combines_with_ctrl() {
        let encoded = encode_key(&KeyInput {
            key: "c".to_string(),
            ctrl: true,
            alt: true,
            shift: false,
            meta: false,
            application_cursor: false,
        });
        assert_eq!(encoded, Some(vec![0x1B, 0x03]));
    }

    #[test]
    fn arrows_use_csi_in_normal_cursor_mode() {
        assert_eq!(plain("ArrowUp"), Some(b"\x1b[A".to_vec()));
        assert_eq!(plain("ArrowDown"), Some(b"\x1b[B".to_vec()));
        assert_eq!(plain("ArrowRight"), Some(b"\x1b[C".to_vec()));
        assert_eq!(plain("ArrowLeft"), Some(b"\x1b[D".to_vec()));
    }

    #[test]
    fn arrows_use_ss3_in_application_cursor_mode() {
        // Neovim turns DECCKM on; getting this wrong breaks every arrow key.
        let up = encode_key(&KeyInput {
            key: "ArrowUp".to_string(),
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            application_cursor: true,
        });
        assert_eq!(up, Some(b"\x1bOA".to_vec()));
    }

    #[test]
    fn navigation_and_editing_keys_encode_to_csi_sequences() {
        assert_eq!(plain("Home"), Some(b"\x1b[H".to_vec()));
        assert_eq!(plain("End"), Some(b"\x1b[F".to_vec()));
        assert_eq!(plain("PageUp"), Some(b"\x1b[5~".to_vec()));
        assert_eq!(plain("PageDown"), Some(b"\x1b[6~".to_vec()));
        assert_eq!(plain("Insert"), Some(b"\x1b[2~".to_vec()));
        assert_eq!(plain("Delete"), Some(b"\x1b[3~".to_vec()));
    }

    #[test]
    fn function_keys_encode_to_their_conventional_sequences() {
        assert_eq!(plain("F1"), Some(b"\x1bOP".to_vec()));
        assert_eq!(plain("F4"), Some(b"\x1bOS".to_vec()));
        assert_eq!(plain("F5"), Some(b"\x1b[15~".to_vec()));
        assert_eq!(plain("F12"), Some(b"\x1b[24~".to_vec()));
    }

    #[test]
    fn meta_modified_keys_are_left_to_the_host_application() {
        // Cmd+S must reach Cadencr's shortcut system, not the terminal.
        let encoded = encode_key(&KeyInput {
            key: "s".to_string(),
            ctrl: false,
            alt: false,
            shift: false,
            meta: true,
            application_cursor: false,
        });
        assert_eq!(encoded, None);
    }

    #[test]
    fn unknown_keys_return_none_rather_than_empty_bytes() {
        // None is distinguishable from "a key that legitimately sends nothing";
        // an empty Vec would not be.
        assert_eq!(plain("Shift"), None);
        assert_eq!(plain("Control"), None);
        assert_eq!(plain("Dead"), None);
        assert_eq!(plain("F13"), None);
    }
}
