//! JavaScript-facing façade. Type conversion only — every rule lives in
//! `terminal`, `input`, and `snapshot`, where it is tested natively.

use wasm_bindgen::prelude::*;

use crate::input::{
    encode_key, encode_mouse, KeyInput, MouseButton, MouseEventKind, MouseInput, MouseReporting,
};
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

    /// Mouse reporting mode as a small integer: 0 none, 1 click, 2 drag,
    /// 3 motion. Feed it straight back into `encodeMouse`.
    #[wasm_bindgen(getter, js_name = mouseReporting)]
    pub fn mouse_reporting(&self) -> u8 {
        match self.core.mouse_reporting() {
            MouseReporting::None => 0,
            MouseReporting::Click => 1,
            MouseReporting::Drag => 2,
            MouseReporting::Motion => 3,
        }
    }

    #[wasm_bindgen(getter, js_name = sgrMouse)]
    pub fn sgr_mouse(&self) -> bool {
        self.core.sgr_mouse()
    }

    #[wasm_bindgen(getter, js_name = alternateScroll)]
    pub fn alternate_scroll(&self) -> bool {
        self.core.alternate_scroll()
    }

    #[wasm_bindgen(getter, js_name = altScreen)]
    pub fn alt_screen(&self) -> bool {
        self.core.alt_screen()
    }

    /// Rewrite the packed grid buffer. Call once per frame, before reading the
    /// snapshot pointer.
    #[wasm_bindgen(js_name = refreshSnapshot)]
    pub fn refresh_snapshot(&mut self) {
        self.core.refresh_snapshot();
    }

    /// Offset of the packed grid inside the module's linear memory.
    ///
    /// **The view built from this pointer expires.** Any Rust allocation can
    /// grow the module's memory, which replaces the underlying `ArrayBuffer`
    /// and detaches every existing view. Rebuild the `Uint32Array` after each
    /// `feed()` or `resize()` — never cache it across frames.
    #[wasm_bindgen(js_name = snapshotPtr)]
    pub fn snapshot_ptr(&self) -> *const u32 {
        self.core.snapshot().as_ptr()
    }

    /// Length of the packed grid, in `u32` words.
    #[wasm_bindgen(js_name = snapshotLen)]
    pub fn snapshot_len(&self) -> usize {
        self.core.snapshot().len()
    }

    /// Lines changed since the last call, as flat `(line, left, right)`
    /// triplets with an inclusive right column. Taking the damage clears it.
    #[wasm_bindgen(js_name = takeDamage)]
    pub fn take_damage(&mut self) -> Vec<u32> {
        self.core.take_damage().to_vec()
    }

    /// One row as text. Debugging aid — renderers use `snapshotPtr` and
    /// `snapshotLen`.
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

/// Encode a mouse event as PTY bytes.
///
/// `kind`: 0 press, 1 release, 2 move, 3 scroll up, 4 scroll down.
/// `button`: 0 none, 1 left, 2 middle, 3 right.
/// `reporting`: 0 none, 1 click, 2 drag, 3 motion — take it from the
/// terminal's `mouseReporting` getter.
///
/// Returns `undefined` when the event must not be reported.
#[wasm_bindgen(js_name = encodeMouse)]
#[allow(clippy::too_many_arguments)]
pub fn encode_mouse_js(
    kind: u8,
    button: u8,
    line: usize,
    column: usize,
    ctrl: bool,
    alt: bool,
    shift: bool,
    sgr_enabled: bool,
    reporting: u8,
    alternate_scroll: bool,
    alt_screen: bool,
    application_cursor: bool,
) -> Option<Vec<u8>> {
    let kind = match kind {
        0 => MouseEventKind::Press,
        1 => MouseEventKind::Release,
        2 => MouseEventKind::Move,
        3 => MouseEventKind::ScrollUp,
        4 => MouseEventKind::ScrollDown,
        _ => return None,
    };
    let button = match button {
        0 => MouseButton::None,
        1 => MouseButton::Left,
        2 => MouseButton::Middle,
        3 => MouseButton::Right,
        _ => return None,
    };
    let reporting = match reporting {
        0 => MouseReporting::None,
        1 => MouseReporting::Click,
        2 => MouseReporting::Drag,
        3 => MouseReporting::Motion,
        _ => return None,
    };

    encode_mouse(&MouseInput {
        kind,
        button,
        line,
        column,
        ctrl,
        alt,
        shift,
        sgr_enabled,
        reporting,
        alternate_scroll,
        alt_screen,
        application_cursor,
    })
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
