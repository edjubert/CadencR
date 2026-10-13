import type { Shortcut } from "./types";

/**
 * Sidebar shortcuts: moving through the tree, acting on the focused
 * conversation row, and jumping to the next conversation that needs you.
 * The row actions only fire while a conversation row has focus, so they can
 * reuse chords other scopes bind (⌘⌫ is the terminal's delete-line, F2 the
 * editor's rename symbol); printable keys stay free for type-to-filter.
 */
export const SIDEBAR_SHORTCUTS = [
  {
    // ⌘J — "jump" to whoever is waiting on you: pending requests oldest first,
    // then failed turns, cycling from the open conversation.
    id: "attention-next-needs-you",
    keys: ["mod", "j"],
    description: "Next conversation waiting on you",
    scope: "global",
    aliases: ["for me", "pending", "approval", "inbox"],
  },
  {
    id: "attention-next-unread",
    keys: ["mod", "alt", "j"],
    description: "Next unread conversation",
    scope: "global",
    aliases: ["for me", "inbox"],
  },
  {
    id: "sidebar-focus-down",
    keys: ["mod", "alt", "down"],
    description: "Move focus down",
    scope: "sidebar",
  },
  {
    id: "sidebar-focus-up",
    keys: ["mod", "alt", "up"],
    description: "Move focus up",
    scope: "sidebar",
  },
  {
    id: "sidebar-activate",
    keys: ["enter"],
    description: "Open focused item",
    scope: "sidebar",
  },
  {
    id: "sidebar-row-pin",
    keys: ["mod", "alt", "p"],
    description: "Pin / unpin the focused conversation",
    scope: "sidebar",
  },
  {
    id: "sidebar-row-archive",
    keys: ["mod", "backspace"],
    description: "Archive the focused conversation",
    scope: "sidebar",
  },
  {
    id: "sidebar-row-rename",
    keys: ["f2"],
    description: "Rename the focused conversation",
    scope: "sidebar",
  },
  {
    id: "sidebar-row-label",
    keys: ["mod", "alt", "l"],
    description: "Set the focused conversation's label",
    scope: "sidebar",
  },
  {
    id: "sidebar-row-toggle-unread",
    keys: ["mod", "alt", "u"],
    description: "Mark the focused conversation read / unread",
    scope: "sidebar",
  },
] as const satisfies readonly Shortcut[];
