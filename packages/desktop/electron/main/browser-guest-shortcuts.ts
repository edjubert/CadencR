import { z } from "zod";

import type { BrowserGuestShortcutBindings } from "./browser-types";

const SHORTCUT_MODIFIERS = new Set(["mod", "ctrl", "alt", "shift"]);

function isValidShortcutChord(keys: string[]): boolean {
  if (keys.length === 0) return true;
  return keys.filter((key) => !SHORTCUT_MODIFIERS.has(key.toLowerCase())).length === 1;
}

const shortcutBindingSchema = z
  .object({
    keys: z.array(z.string().min(1).max(32)).max(8).refine(isValidShortcutChord),
    altKeys: z.array(z.string().min(1).max(32)).max(8).refine(isValidShortcutChord).optional(),
  })
  .strict();

const guestShortcutBindingsSchema = z
  .object({
    find: shortcutBindingSchema,
    downloads: shortcutBindingSchema,
    responsive: shortcutBindingSchema,
    devtools: shortcutBindingSchema,
    zoomReset: shortcutBindingSchema,
  })
  .strict();

export function parseBrowserGuestShortcutBindings(value: unknown): BrowserGuestShortcutBindings {
  return guestShortcutBindingsSchema.parse(value);
}
