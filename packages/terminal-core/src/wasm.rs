//! JavaScript-facing façade. Type conversion only — every rule lives in
//! `terminal`, `input`, and `snapshot`, where it is tested natively.

use wasm_bindgen::prelude::*;

use crate::input::{encode_key, KeyInput};
use crate::terminal::{TerminalCore, TerminalSize};

/// Assemble a `KeyInput` from the flat arguments `wasm_bindgen` can pass.
/// Extracted so the conversion is testable without a JS runtime.
fn build_key_input(
    key: String,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    application_cursor: bool,
) -> KeyInput {
    KeyInput {
        key,
        ctrl,
        alt,
        shift,
        meta,
        application_cursor,
    }
}

/// A terminal grid driven from JavaScript.
#[wasm_bindgen]
pub struct Terminal {
    core: TerminalCore,
}

#[wasm_bindgen]
impl Terminal {
    #[wasm_bindgen(constructor)]
    pub fn new(columns: usize, screen_lines: usize) -> Terminal {
        Terminal {
            core: TerminalCore::new(TerminalSize {
                columns,
                screen_lines,
            }),
        }
    }

    /// Feed a chunk of PTY output. Safe to call with a sequence split across
    /// chunks — the parser keeps its state.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.core.feed(bytes);
    }

    pub fn resize(&mut self, columns: usize, screen_lines: usize) {
        self.core.resize(TerminalSize {
            columns,
            screen_lines,
        });
    }

    #[wasm_bindgen(getter)]
    pub fn columns(&self) -> usize {
        self.core.columns()
    }

    #[wasm_bindgen(getter, js_name = screenLines)]
    pub fn screen_lines(&self) -> usize {
        self.core.screen_lines()
    }

    #[wasm_bindgen(getter, js_name = cursorLine)]
    pub fn cursor_line(&self) -> usize {
        self.core.cursor_line()
    }

    #[wasm_bindgen(getter, js_name = cursorColumn)]
    pub fn cursor_column(&self) -> usize {
        self.core.cursor_column()
    }

    /// Whether DECCKM is on. Feed this back into `encodeKey` so the arrow keys
    /// emit what the running application expects.
    #[wasm_bindgen(getter, js_name = applicationCursor)]
    pub fn application_cursor(&self) -> bool {
        self.core.application_cursor()
    }

    /// The viewport packed as four `u32` per cell — character, foreground,
    /// background, flags — in row-major order.
    ///
    /// Returned as a `Uint32Array` view rather than a `Vec`, which
    /// `wasm_bindgen` would otherwise marshal into a JS `Array` of boxed
    /// numbers and defeat the point of a packed format.
    #[wasm_bindgen(js_name = packedSnapshot)]
    pub fn packed_snapshot(&self) -> js_sys::Uint32Array {
        let packed = self.core.packed_snapshot();
        js_sys::Uint32Array::from(&packed[..])
    }

    /// One row as text. Debugging aid — renderers use `packedSnapshot`.
    #[wasm_bindgen(js_name = rowText)]
    pub fn row_text(&self, line: usize) -> String {
        self.core.row_text(line)
    }
}

/// Encode a `keydown` as PTY bytes.
///
/// Returns `undefined` when the key produces no terminal input — a bare
/// modifier, an unmapped key, or anything held with Meta, which belongs to the
/// host application's shortcuts. Distinguishable by the caller from a key that
/// legitimately sends nothing.
#[wasm_bindgen(js_name = encodeKey)]
pub fn encode_key_js(
    key: String,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    application_cursor: bool,
) -> Option<Vec<u8>> {
    let input = build_key_input(key, ctrl, alt, shift, meta, application_cursor);
    encode_key(&input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_input_is_built_verbatim_from_its_parts() {
        let input = build_key_input("ArrowUp".to_string(), false, true, false, false, true);
        assert_eq!(input.key, "ArrowUp");
        assert!(!input.ctrl);
        assert!(input.alt);
        assert!(!input.shift);
        assert!(!input.meta);
        assert!(input.application_cursor);
    }

    #[test]
    fn built_key_input_encodes_the_same_as_a_hand_written_one() {
        // The façade must not reorder or drop flags on the way through.
        let built = build_key_input("c".to_string(), true, false, false, false, false);
        let expected = crate::input::KeyInput {
            key: "c".to_string(),
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            application_cursor: false,
        };
        assert_eq!(
            crate::input::encode_key(&built),
            crate::input::encode_key(&expected)
        );
        assert_eq!(crate::input::encode_key(&built), Some(vec![0x03]));
    }
}
