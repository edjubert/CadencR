// Translates a browser KeyboardEvent into Neovim's key notation, so a
// captured keydown can be forwarded verbatim as `nvim_input` (Phase 1a/1c).
// See https://neovim.io/doc/user/intro.html#key-notation for the notation
// reference.

const NAMED_KEYS: Record<string, string> = {
  Escape: "<Esc>",
  Enter: "<CR>",
  Tab: "<Tab>",
  Backspace: "<BS>",
  ArrowLeft: "<Left>",
  ArrowDown: "<Down>",
  ArrowUp: "<Up>",
  ArrowRight: "<Right>",
};

/**
 * Standalone modifier keydowns (holding Shift before the letter it modifies
 * fires its own keydown first) and other non-character keys the browser can
 * emit — dead keys from compose sequences, unrecognized keys — have no
 * Neovim key-notation equivalent and must never be forwarded as literal
 * text. Sending "Shift" as 5 characters to a normal-mode buffer previously
 * garbled every capitalized keystroke (Shift-A, Shift-$, etc.).
 */
const IGNORED_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "CapsLock",
  "Dead",
  "Unidentified",
  "ContextMenu",
  "Fn",
  "FnLock",
  "Hyper",
  "Super",
  "NumLock",
  "ScrollLock",
  "ProcessKey",
]);

/** Returns `null` for keydowns with no Neovim key-notation equivalent (see `IGNORED_KEYS`) — callers must skip sending. */
export function toNeovimKeyNotation(event: KeyboardEvent): string | null {
  if (IGNORED_KEYS.has(event.key)) {
    return null;
  }

  if (event.ctrlKey && event.key.length === 1) {
    return `<C-${event.key.toLowerCase()}>`;
  }

  if (event.key in NAMED_KEYS) {
    return NAMED_KEYS[event.key];
  }

  return event.key;
}
