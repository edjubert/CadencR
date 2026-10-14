/**
 * Browser-tab shortcut entries. Extracted from `entries.ts` to keep the
 * canonical file under the 400-line limit; merged back into the combined
 * `SHORTCUTS` array exported from `entries.ts`.
 *
 * These mirror real-browser chrome chords. They share combos with the agent
 * tab (⌘T) and the window-close fallback (⌘W) but are scoped to the Browser
 * tab, so the focus gate in `useScopedGlobalShortcut` keeps them from
 * colliding. When the guest page itself has keyboard focus the main process
 * relays the same chords (see `browser-tab-events.ts`).
 */
import type { Shortcut } from "./types";

export const BROWSER_SHORTCUTS = [
  {
    id: "browser-new-tab",
    keys: ["mod", "t"],
    description: "New browser tab",
    scope: "browser",
  },
  {
    id: "browser-close",
    keys: ["mod", "w"],
    description: "Close browser tab",
    scope: "browser",
  },
  {
    // Chrome's customary Mod+Shift+T belongs to Cadencr's Terminal pane.
    id: "browser-reopen-tab",
    keys: ["mod", "shift", "u"],
    description: "Reopen last closed browser tab",
    scope: "browser",
  },
  {
    id: "browser-prev-tab",
    keys: ["mod", "shift", "lbracket"],
    description: "Previous browser tab",
    scope: "browser",
  },
  {
    id: "browser-next-tab",
    keys: ["mod", "shift", "rbracket"],
    description: "Next browser tab",
    scope: "browser",
  },
  {
    id: "browser-focus-url",
    keys: ["mod", "l"],
    description: "Focus the address bar",
    scope: "browser",
  },
  {
    id: "browser-reload",
    keys: ["mod", "r"],
    description: "Reload the page",
    scope: "browser",
  },
  {
    id: "browser-find",
    keys: ["mod", "f"],
    description: "Find in page",
    scope: "browser",
  },
  {
    id: "browser-add-comment",
    keys: ["mod", "s"],
    description: "Add a page comment",
    scope: "browser",
  },
  {
    id: "browser-downloads",
    keys: ["mod", "shift", "j"],
    description: "Show browser downloads",
    scope: "browser",
  },
  {
    id: "browser-responsive",
    keys: ["mod", "shift", "m"],
    description: "Toggle responsive mode",
    scope: "browser",
  },
  {
    // Electron owns Cmd+Opt+I / Ctrl+Shift+I for the app renderer's DevTools.
    // F12 is also a standard browser binding and reaches the Browser guest in
    // both development and packaged builds without opening the wrong tools.
    id: "browser-devtools",
    keys: ["f12"],
    description: "Toggle browser DevTools",
    scope: "browser",
  },
] as const satisfies readonly Shortcut[];
