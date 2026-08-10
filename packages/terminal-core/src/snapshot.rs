//! Compact, JS-transferable representation of a terminal grid.

use vte::ansi::Color;

/// Tag stored in the high byte of an encoded color.
const TAG_PALETTE: u32 = 1 << 24;
const TAG_RGB: u32 = 2 << 24;

/// Number of `u32` words each cell occupies in a packed snapshot:
/// character, foreground, background, flags.
pub const WORDS_PER_CELL: usize = 4;

/// Pack a cell color into a single `u32` for transfer to JavaScript.
///
/// The high byte is a tag and the low 24 bits are the payload: either a
/// palette slot (named and indexed colors both resolve to one) or a packed
/// `0xRRGGBB`. The payload is 24 bits rather than 8 because alacritty's named
/// slots start at 256 (`NamedColor::Foreground`), so an 8-bit payload would
/// truncate the most common color of all.
pub fn encode_color(color: Color) -> u32 {
    match color {
        Color::Named(named) => TAG_PALETTE | (named as u32),
        Color::Indexed(index) => TAG_PALETTE | u32::from(index),
        Color::Spec(rgb) => {
            TAG_RGB | (u32::from(rgb.r) << 16) | (u32::from(rgb.g) << 8) | u32::from(rgb.b)
        }
    }
}

/// Whether an encoded color refers to a palette slot the renderer must resolve
/// against the active theme.
pub fn is_palette(encoded: u32) -> bool {
    encoded & 0xFF00_0000 == TAG_PALETTE
}

/// Whether an encoded color carries a literal `0xRRGGBB`.
pub fn is_rgb(encoded: u32) -> bool {
    encoded & 0xFF00_0000 == TAG_RGB
}

/// The 24-bit payload of an encoded color: a palette slot or a packed RGB.
pub fn payload(encoded: u32) -> u32 {
    encoded & 0x00FF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;
    use vte::ansi::{Color, NamedColor, Rgb};

    #[test]
    fn named_colors_encode_as_palette_indices() {
        let encoded = encode_color(Color::Named(NamedColor::Red));
        assert!(is_palette(encoded));
        assert_eq!(payload(encoded), NamedColor::Red as u32);
    }

    #[test]
    fn foreground_slot_survives_a_24_bit_payload() {
        // NamedColor::Foreground discriminates to 256 — above the 8-bit
        // palette. This proves the payload is genuinely 24 bits: an 8-bit
        // encoding would silently truncate the default foreground color.
        let encoded = encode_color(Color::Named(NamedColor::Foreground));
        assert!(is_palette(encoded));
        assert_eq!(payload(encoded), 256);
    }

    #[test]
    fn indexed_colors_encode_as_palette_indices() {
        let encoded = encode_color(Color::Indexed(200));
        assert!(is_palette(encoded));
        assert_eq!(payload(encoded), 200);
    }

    #[test]
    fn true_color_encodes_as_packed_rgb() {
        let encoded = encode_color(Color::Spec(Rgb { r: 0x12, g: 0x34, b: 0x56 }));
        assert!(is_rgb(encoded));
        assert_eq!(payload(encoded), 0x0012_3456);
    }

    #[test]
    fn palette_and_rgb_tags_are_mutually_exclusive() {
        let palette = encode_color(Color::Indexed(7));
        let rgb = encode_color(Color::Spec(Rgb { r: 0, g: 0, b: 7 }));
        assert!(is_palette(palette) && !is_rgb(palette));
        assert!(is_rgb(rgb) && !is_palette(rgb));
    }
}
