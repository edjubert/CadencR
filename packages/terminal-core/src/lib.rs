//! In-browser terminal engine for Cadencr's Neovim editor panel.
//!
//! Turns the raw ANSI byte stream of a PTY into a grid of cells that a
//! renderer can draw, and encodes user input back into the bytes a terminal
//! application expects. Rendering itself lives outside this crate.

pub mod input;
pub mod snapshot;
pub mod terminal;
pub mod wasm;

pub use input::{encode_key, KeyInput};
pub use snapshot::WORDS_PER_CELL;
pub use terminal::{TerminalCore, TerminalSize};
