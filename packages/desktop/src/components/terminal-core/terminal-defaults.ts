import type { TerminalOptions } from "./cathode-term-stubs";

export const TERMINAL_DEFAULTS: TerminalOptions = {
  bellStyle: "none",
  cursorBlink: true,
  cursorStyle: "block",
  cursorWidth: 2,
  scrollback: 5000,
  fontSize: 13,
  fontFamily:
    "'FiraCode Nerd Font', 'Fira Code', 'CaskaydiaCove Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  fontWeight: "400",
  fontWeightBold: "600",
  letterSpacing: 0,
  lineHeight: 1.2,
  allowTransparency: true,
  macOptionIsMeta: true,
};
