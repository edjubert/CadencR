import { describe, expect, it } from "vitest";
import { buildPaletteOverrides } from "./neovim-palette";
import type { XTermPalette } from "@/lib/themes/types";

const PALETTE: XTermPalette = {
  background: "#1a1a1a",
  foreground: "#dddddd",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#333333",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#222222",
  black: "#000000",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#e06c75",
  brightGreen: "#98c379",
  brightYellow: "#e5c07b",
  brightBlue: "#61afef",
  brightMagenta: "#c678dd",
  brightCyan: "#56b6c2",
  brightWhite: "#ffffff",
};

describe("buildPaletteOverrides", () => {
  it("maps the 16 ANSI slots in NamedColor order", () => {
    const overrides = buildPaletteOverrides(PALETTE);
    expect(overrides.get(0)).toBe(PALETTE.black);
    expect(overrides.get(1)).toBe(PALETTE.red);
    expect(overrides.get(7)).toBe(PALETTE.white);
    expect(overrides.get(8)).toBe(PALETTE.brightBlack);
    expect(overrides.get(15)).toBe(PALETTE.brightWhite);
  });

  it("maps default foreground, background and cursor to their named slots", () => {
    const overrides = buildPaletteOverrides(PALETTE);
    // 256/257/258: alacritty's NamedColor::Foreground/Background/Cursor.
    expect(overrides.get(256)).toBe(PALETTE.foreground);
    expect(overrides.get(257)).toBe(PALETTE.background);
    expect(overrides.get(258)).toBe(PALETTE.cursor);
  });

  it("produces exactly 19 entries — no more, no less", () => {
    const overrides = buildPaletteOverrides(PALETTE);
    expect(overrides.size).toBe(19);
  });
});
