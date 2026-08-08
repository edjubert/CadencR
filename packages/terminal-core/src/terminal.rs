//! Drives an `alacritty_terminal` grid from a raw ANSI byte stream.

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Config, Term, TermDamage, TermMode};
use vte::ansi::Processor;

use crate::snapshot::{encode_color, WORDS_PER_CELL};

/// `Term` reports host-level events (bell, title changes, clipboard requests)
/// through this trait. None of them are acted on yet — the renderer will decide
/// which ones matter once it exists.
#[derive(Clone)]
struct NoopListener;

impl EventListener for NoopListener {
    fn send_event(&self, _event: Event) {}
}

/// Viewport dimensions, in cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalSize {
    pub columns: usize,
    pub screen_lines: usize,
}

impl TerminalSize {
    /// A collapsed or hidden panel legitimately reports 0×0, which no grid can
    /// represent. Clamp to 1×1 rather than panicking: a resize is not a place
    /// to take the panel down.
    fn clamped(self) -> Self {
        Self {
            columns: self.columns.max(1),
            screen_lines: self.screen_lines.max(1),
        }
    }
}

impl Dimensions for TerminalSize {
    fn total_lines(&self) -> usize {
        self.screen_lines
    }

    fn screen_lines(&self) -> usize {
        self.screen_lines
    }

    fn columns(&self) -> usize {
        self.columns
    }
}

/// An ANSI-driven terminal grid: feed it PTY bytes, read cells back.
pub struct TerminalCore {
    term: Term<NoopListener>,
    parser: Processor,
    /// Reused across frames: rewritten in place by `refresh_snapshot` so no
    /// allocation happens on the render path.
    packed: Vec<u32>,
    /// Flat `(line, left, right)` triplets, refilled by `take_damage`.
    damage: Vec<u32>,
}

impl TerminalCore {
    pub fn new(size: TerminalSize) -> Self {
        let size = size.clamped();
        let cells = size.columns * size.screen_lines;
        Self {
            term: Term::new(Config::default(), &size, NoopListener),
            parser: Processor::new(),
            packed: vec![0; cells * WORDS_PER_CELL],
            damage: Vec::new(),
        }
    }

    /// Feed a chunk of PTY output. The parser keeps its state across calls, so
    /// an escape sequence split across two reads is handled correctly.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    pub fn resize(&mut self, size: TerminalSize) {
        let size = size.clamped();
        self.term.resize(size);
        self.packed
            .resize(size.columns * size.screen_lines * WORDS_PER_CELL, 0);
    }

    pub fn columns(&self) -> usize {
        self.term.columns()
    }

    pub fn screen_lines(&self) -> usize {
        self.term.screen_lines()
    }

    /// Cursor row within the viewport, 0-indexed.
    pub fn cursor_line(&self) -> usize {
        let line = self.term.grid().cursor.point.line.0;
        usize::try_from(line).unwrap_or(0)
    }

    /// Cursor column, 0-indexed.
    pub fn cursor_column(&self) -> usize {
        self.term.grid().cursor.point.column.0
    }

    /// Whether DECCKM (application cursor keys) is enabled. The renderer reads
    /// this to encode arrow keys correctly — Neovim turns it on.
    pub fn application_cursor(&self) -> bool {
        self.term.mode().contains(TermMode::APP_CURSOR)
    }

    /// Which mouse reports the running application asked for.
    pub fn mouse_reporting(&self) -> crate::input::MouseReporting {
        let mode = self.term.mode();
        if mode.contains(TermMode::MOUSE_MOTION) {
            crate::input::MouseReporting::Motion
        } else if mode.contains(TermMode::MOUSE_DRAG) {
            crate::input::MouseReporting::Drag
        } else if mode.contains(TermMode::MOUSE_REPORT_CLICK) {
            crate::input::MouseReporting::Click
        } else {
            crate::input::MouseReporting::None
        }
    }

    /// Whether SGR (1006) mouse encoding is enabled.
    pub fn sgr_mouse(&self) -> bool {
        self.term.mode().contains(TermMode::SGR_MOUSE)
    }

    /// Whether alternate scroll is enabled — the wheel then drives the
    /// alternate screen's pager with arrow keys instead of mouse reports.
    pub fn alternate_scroll(&self) -> bool {
        self.term.mode().contains(TermMode::ALTERNATE_SCROLL)
    }

    /// Whether the alternate screen is active.
    pub fn alt_screen(&self) -> bool {
        self.term.mode().contains(TermMode::ALT_SCREEN)
    }

    /// One viewport row as text, trailing blanks trimmed. Reading aid for
    /// tests and debugging — the renderer uses `refresh_snapshot` + `snapshot`.
    pub fn row_text(&self, line: usize) -> String {
        let grid = self.term.grid();
        let line = Line(line as i32);
        let mut text = String::with_capacity(self.columns());
        for column in 0..self.columns() {
            text.push(grid[Point::new(line, Column(column))].c);
        }
        text.trim_end().to_string()
    }

    /// Rewrite the packed buffer from the current grid.
    ///
    /// Writes in place — no allocation on the render path. Call once per frame,
    /// before reading `snapshot`.
    pub fn refresh_snapshot(&mut self) {
        let columns = self.term.columns();
        let lines = self.term.screen_lines();
        let grid = self.term.grid();
        // The cursor is not a grid cell: alacritty keeps it in `grid().cursor`
        // and leaves drawing it to the renderer. Captured here, applied below.
        let cursor = grid.cursor.point;
        let show_cursor = self.term.mode().contains(TermMode::SHOW_CURSOR);

        let mut index = 0;
        for line in 0..lines {
            for column in 0..columns {
                let cell = &grid[Point::new(Line(line as i32), Column(column))];
                self.packed[index] = cell.c as u32;
                self.packed[index + 1] = encode_color(cell.fg);
                self.packed[index + 2] = encode_color(cell.bg);
                self.packed[index + 3] = u32::from(cell.flags.bits());
                index += WORDS_PER_CELL;
            }
        }

        // Marking the cursor cell INVERSE paints a block cursor with the shader
        // path that already swaps foreground and background — no extra draw
        // call, no second pipeline.
        if show_cursor {
            let line = usize::try_from(cursor.line.0).unwrap_or(0);
            let column = cursor.column.0;
            if line < lines && column < columns {
                let flags = (line * columns + column) * WORDS_PER_CELL + 3;
                self.packed[flags] |= u32::from(Flags::INVERSE.bits());
            }
        }
    }

    /// The packed viewport: four `u32` per cell — character, foreground,
    /// background, flags — in row-major order. Valid until the next
    /// `refresh_snapshot`.
    pub fn snapshot(&self) -> &[u32] {
        &self.packed
    }

    /// Lines changed since the last call, as flat `(line, left, right)`
    /// triplets with an inclusive right column. Taking the damage clears it.
    ///
    /// A fully damaged grid — after a resize, an alternate-screen switch, or
    /// entering insert mode — is flattened into a single triplet per line
    /// covering the whole viewport, so callers only ever handle one shape.
    pub fn take_damage(&mut self) -> &[u32] {
        self.damage.clear();

        let columns = self.term.columns();
        let lines = self.term.screen_lines();

        match self.term.damage() {
            TermDamage::Full => {
                let last_column = columns.saturating_sub(1) as u32;
                for line in 0..lines {
                    self.damage.push(line as u32);
                    self.damage.push(0);
                    self.damage.push(last_column);
                }
            }
            TermDamage::Partial(iterator) => {
                for bounds in iterator {
                    self.damage.push(bounds.line as u32);
                    self.damage.push(bounds.left as u32);
                    self.damage.push(bounds.right as u32);
                }
            }
        }

        self.term.reset_damage();
        &self.damage
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Read a whole grid row back as a string, trailing blanks trimmed.
    fn row(core: &TerminalCore, line: usize) -> String {
        core.row_text(line)
    }

    #[test]
    fn plain_text_lands_in_the_grid() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.feed(b"hello");
        assert_eq!(row(&core, 0), "hello");
    }

    #[test]
    fn escape_sequences_are_interpreted_not_printed() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.feed(b"\x1b[1;31mhi\x1b[0m");
        assert_eq!(row(&core, 0), "hi");
    }

    #[test]
    fn cursor_positioning_writes_at_the_requested_column() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.feed(b"\x1b[1;5HX");
        assert_eq!(row(&core, 0), "    X");
    }

    #[test]
    fn erase_in_line_clears_prior_content() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.feed(b"abcdef\x1b[1;1H\x1b[2K");
        assert_eq!(row(&core, 0), "");
    }

    #[test]
    fn feeding_in_two_chunks_matches_feeding_at_once() {
        let mut split = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        // Escape sequence deliberately cut in half across the two chunks: the
        // parser must hold state between calls, since a PTY read can land
        // anywhere in a sequence.
        split.feed(b"\x1b[1;");
        split.feed(b"5HX");

        let mut whole = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        whole.feed(b"\x1b[1;5HX");

        assert_eq!(split.row_text(0), whole.row_text(0));
        assert_eq!(split.row_text(0), "    X");
    }

    #[test]
    fn the_cursor_cell_is_marked_inverse_so_the_shader_paints_a_block() {
        let mut core = TerminalCore::new(TerminalSize { columns: 4, screen_lines: 1 });
        core.feed(b"ab");
        core.refresh_snapshot();

        let inverse = u32::from(Flags::INVERSE.bits());
        let flags_of = |cell: usize| core.snapshot()[cell * WORDS_PER_CELL + 3];
        // Cursor sits on column 2, just past the typed text.
        assert_eq!(flags_of(2) & inverse, inverse, "cursor cell must be inverse");
        assert_eq!(flags_of(0) & inverse, 0, "other cells must be untouched");
    }

    #[test]
    fn a_hidden_cursor_leaves_every_cell_untouched() {
        let mut core = TerminalCore::new(TerminalSize { columns: 4, screen_lines: 1 });
        // DECTCEM off — Neovim hides the cursor while repainting.
        core.feed(b"ab\x1b[?25l");
        core.refresh_snapshot();

        let inverse = u32::from(Flags::INVERSE.bits());
        for cell in 0..4 {
            assert_eq!(core.snapshot()[cell * WORDS_PER_CELL + 3] & inverse, 0);
        }
    }

    #[test]
    fn sgr_attributes_reach_the_packed_snapshot() {
        let mut core = TerminalCore::new(TerminalSize { columns: 4, screen_lines: 1 });
        core.feed(b"\x1b[1;38;2;18;52;86mA");
        core.refresh_snapshot();
        let packed = core.snapshot();
        assert_eq!(packed.len(), 4 * crate::snapshot::WORDS_PER_CELL);

        let ch = packed[0];
        let fg = packed[1];
        let flags = packed[3];
        assert_eq!(char::from_u32(ch), Some('A'));
        assert!(crate::snapshot::is_rgb(fg));
        assert_eq!(crate::snapshot::payload(fg), 0x0012_3456);
        assert_ne!(flags, 0, "bold should be recorded in the flags word");
    }

    #[test]
    fn resize_changes_the_reported_dimensions() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.resize(TerminalSize { columns: 40, screen_lines: 10 });
        assert_eq!(core.columns(), 40);
        assert_eq!(core.screen_lines(), 10);
        core.refresh_snapshot();
        assert_eq!(core.snapshot().len(), 40 * 10 * crate::snapshot::WORDS_PER_CELL);
    }

    #[test]
    fn zero_sized_dimensions_are_clamped_to_one() {
        // A hidden or collapsed panel can legitimately report 0×0. Neither the
        // grid nor the renderer can work with that, and panicking on a resize
        // would take the whole panel down — clamp instead, visibly.
        let core = TerminalCore::new(TerminalSize { columns: 0, screen_lines: 0 });
        assert_eq!(core.columns(), 1);
        assert_eq!(core.screen_lines(), 1);
    }

    #[test]
    fn cursor_position_follows_the_written_text() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        core.feed(b"\x1b[3;7Habc");
        // CUP is 1-indexed; the cursor ends three columns past where it landed.
        assert_eq!(core.cursor_line(), 2);
        assert_eq!(core.cursor_column(), 9);
    }

    #[test]
    fn application_cursor_mode_follows_the_decckm_escape_sequence() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        assert!(!core.application_cursor(), "DECCKM starts off");

        core.feed(b"\x1b[?1h");
        assert!(core.application_cursor(), "CSI ? 1 h enables DECCKM");

        core.feed(b"\x1b[?1l");
        assert!(!core.application_cursor(), "CSI ? 1 l disables DECCKM");
    }

    #[test]
    fn the_snapshot_buffer_is_reused_across_frames() {
        let mut core = TerminalCore::new(TerminalSize { columns: 10, screen_lines: 3 });
        core.feed(b"abc");
        core.refresh_snapshot();
        let first_ptr = core.snapshot().as_ptr();

        core.feed(b"def");
        core.refresh_snapshot();
        let second_ptr = core.snapshot().as_ptr();

        assert_eq!(
            first_ptr, second_ptr,
            "refreshing must rewrite the existing buffer, not allocate a new one"
        );
    }

    #[test]
    fn refreshing_updates_the_buffer_contents() {
        let mut core = TerminalCore::new(TerminalSize { columns: 10, screen_lines: 1 });
        core.feed(b"a");
        core.refresh_snapshot();
        assert_eq!(char::from_u32(core.snapshot()[0]), Some('a'));

        core.feed(b"\x1b[1;1Hb");
        core.refresh_snapshot();
        assert_eq!(char::from_u32(core.snapshot()[0]), Some('b'));
    }

    #[test]
    fn the_snapshot_is_sized_for_the_whole_viewport() {
        let mut core = TerminalCore::new(TerminalSize { columns: 10, screen_lines: 3 });
        core.refresh_snapshot();
        assert_eq!(core.snapshot().len(), 10 * 3 * crate::snapshot::WORDS_PER_CELL);
    }

    #[test]
    fn resizing_resizes_the_snapshot_buffer() {
        let mut core = TerminalCore::new(TerminalSize { columns: 10, screen_lines: 3 });
        core.refresh_snapshot();
        core.resize(TerminalSize { columns: 20, screen_lines: 5 });
        core.refresh_snapshot();
        assert_eq!(core.snapshot().len(), 20 * 5 * crate::snapshot::WORDS_PER_CELL);
    }

    #[test]
    fn writing_one_line_reports_only_that_line_as_damaged() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        let _ = core.take_damage();

        core.feed(b"\x1b[3;1Hxyz");
        let damage = core.take_damage();

        assert_eq!(damage.len() % 3, 0, "damage is a flat list of triplets");
        let lines: Vec<u32> = damage.chunks(3).map(|triplet| triplet[0]).collect();
        assert!(
            lines.contains(&2),
            "line 3 (0-indexed 2) should be damaged, got lines {lines:?}"
        );
    }

    #[test]
    fn damage_is_cleared_once_taken() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        let _ = core.take_damage();

        core.feed(b"hello");
        assert!(!core.take_damage().is_empty(), "the write should be damaged");

        // Term::damage() always marks the cursor position as damaged (alacritty
        // behavior). The third call returns exactly one triplet — the cursor at
        // (line 0, col 5) — proving no stale damage from the feed remains.
        let remaining = core.take_damage();
        assert_eq!(remaining.len(), 3, "third call returns exactly cursor damage");
        assert_eq!(remaining[0], 0, "cursor line");
        assert_eq!(remaining[1], 5, "cursor column");
        assert_eq!(remaining[2], 5, "cursor column (inclusive)");
    }

    #[test]
    fn a_resize_reports_the_whole_grid_as_damaged() {
        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        let _ = core.take_damage();

        core.resize(TerminalSize { columns: 30, screen_lines: 8 });
        let damage = core.take_damage();

        assert_eq!(damage.len(), 8 * 3);
        assert_eq!(damage[0], 0);
        assert_eq!(damage[1], 0);
        assert_eq!(damage[2], 29, "right column is inclusive");
    }

    #[test]
    fn mouse_modes_follow_the_escape_sequences_that_set_them() {
        use crate::input::MouseReporting;

        let mut core = TerminalCore::new(TerminalSize { columns: 20, screen_lines: 5 });
        assert_eq!(core.mouse_reporting(), MouseReporting::None);
        assert!(!core.sgr_mouse());

        core.feed(b"\x1b[?1000h\x1b[?1006h");
        assert_eq!(core.mouse_reporting(), MouseReporting::Click);
        assert!(core.sgr_mouse());

        core.feed(b"\x1b[?1002h");
        assert_eq!(core.mouse_reporting(), MouseReporting::Drag);

        core.feed(b"\x1b[?1000l\x1b[?1002l");
        assert_eq!(core.mouse_reporting(), MouseReporting::None);
    }
}
