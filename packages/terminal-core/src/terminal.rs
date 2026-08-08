//! Drives an `alacritty_terminal` grid from a raw ANSI byte stream.

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::{Config, Term, TermMode};
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
}

impl TerminalCore {
    pub fn new(size: TerminalSize) -> Self {
        let size = size.clamped();
        Self {
            term: Term::new(Config::default(), &size, NoopListener),
            parser: Processor::new(),
        }
    }

    /// Feed a chunk of PTY output. The parser keeps its state across calls, so
    /// an escape sequence split across two reads is handled correctly.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    pub fn resize(&mut self, size: TerminalSize) {
        self.term.resize(size.clamped());
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

    /// One viewport row as text, trailing blanks trimmed. Reading aid for
    /// tests and debugging — the renderer uses `packed_snapshot`.
    pub fn row_text(&self, line: usize) -> String {
        let grid = self.term.grid();
        let line = Line(line as i32);
        let mut text = String::with_capacity(self.columns());
        for column in 0..self.columns() {
            text.push(grid[Point::new(line, Column(column))].c);
        }
        text.trim_end().to_string()
    }

    /// The whole viewport packed for transfer to JavaScript: four `u32` per
    /// cell — character, foreground, background, flags — in row-major order.
    pub fn packed_snapshot(&self) -> Vec<u32> {
        let grid = self.term.grid();
        let columns = self.columns();
        let lines = self.screen_lines();
        let mut packed = Vec::with_capacity(columns * lines * WORDS_PER_CELL);

        for line in 0..lines {
            for column in 0..columns {
                let cell = &grid[Point::new(Line(line as i32), Column(column))];
                packed.push(cell.c as u32);
                packed.push(encode_color(cell.fg));
                packed.push(encode_color(cell.bg));
                packed.push(cell.flags.bits() as u32);
            }
        }

        packed
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
    fn sgr_attributes_reach_the_packed_snapshot() {
        let mut core = TerminalCore::new(TerminalSize { columns: 4, screen_lines: 1 });
        // True-color foreground 0x123456 on a bold "A".
        core.feed(b"\x1b[1;38;2;18;52;86mA");
        let packed = core.packed_snapshot();
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
        assert_eq!(core.packed_snapshot().len(), 40 * 10 * crate::snapshot::WORDS_PER_CELL);
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
}
