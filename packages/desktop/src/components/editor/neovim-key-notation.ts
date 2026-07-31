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

export function toNeovimKeyNotation(event: KeyboardEvent): string {
  if (event.ctrlKey && event.key.length === 1) {
    return `<C-${event.key.toLowerCase()}>`;
  }

  if (event.key in NAMED_KEYS) {
    return NAMED_KEYS[event.key];
  }

  return event.key;
}
