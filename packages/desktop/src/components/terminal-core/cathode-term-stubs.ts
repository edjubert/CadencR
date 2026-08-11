/**
 * Stub types and class for `cathode-term`.
 *
 * `cathode-term` is a planned package wrapping `@xterm/xterm` with WebGPU
 * rendering. Until it exists, these stubs let the terminal-core module
 * compile and type-check. They mirror the xterm.js API surface used by
 * the cathode hooks.
 */

import type { XTermPalette } from "@/lib/themes";

// -- Options (maps to AlacrittyConfig + xterm defaults) --

export interface TerminalFontConfig {
  family: string;
  size: number;
  weight?: string;
  boldWeight?: string;
}

export interface TerminalColorsConfig {
  [key: string]: string;
}

export interface TerminalCursorConfig {
  style: "block" | "underline" | "bar";
  blink: boolean;
  fontSize?: number;
}

export interface TerminalScrollingConfig {
  extraLines: number;
}

export interface TerminalOptions {
  bellStyle: "none" | "sound";
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  cursorWidth: number;
  scrollback: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontWeightBold: string;
  letterSpacing: number;
  lineHeight: number;
  allowTransparency: boolean;
  macOptionIsMeta: boolean;
  colors?: TerminalColorsConfig;
  cursor?: TerminalCursorConfig;
  font?: TerminalFontConfig;
  scrolling?: TerminalScrollingConfig;
  theme?: XTermPalette;
}

// -- Transport --

export interface TerminalTransport {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  connect(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): () => void;
  onClose(callback: () => void): () => void;
}

// -- Terminal class (stub) --

export interface Disposable {
  dispose(): void;
}

export interface Terminal {
  readonly element?: HTMLDivElement;
  readonly cols: number;
  readonly rows: number;

  open(parent: HTMLElement): void;
  loadAddon(addon: unknown): void;
  setOptions(options: Partial<TerminalOptions>): void;
  write(data: string): void;
  focus(): void;
  blur(): void;
  clearScreen(): void;
  dispose(): void;
  onData(callback: (data: string) => void): Disposable;
  ready: Promise<void>;
}
