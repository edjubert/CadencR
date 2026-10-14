import { forwardRef } from "react";

/**
 * Shortcut hint pill rendered into each sidebar nav row. Stays out of the
 * row's flex layout (absolute positioning) so it floats over the right
 * edge of the row instead of pushing the label — in narrow sidebars it
 * overlays the label tail rather than truncating it further.
 *
 * Visibility is driven by `data-visible="true"` toggled imperatively via
 * the ref by `ShortcutHintsProvider` on CMD press. Uses opacity instead
 * of the `hidden` attribute so the transition runs; the global
 * `data-animations="off"` kill-switch collapses the transition to 0ms.
 *
 * Styled as a key cap (popover bg, border, soft drop shadow) so it reads
 * as a tappable hint floating over the row even when the row itself is
 * highlighted with `bg-accent`.
 */
export const SidebarShortcutBadge = forwardRef<HTMLSpanElement, { inline?: boolean }>(
  function SidebarShortcutBadge({ inline = false }, ref) {
    return (
      <span
        ref={ref}
        data-nav-shortcut-badge
        data-visible="false"
        aria-hidden="true"
        className={`pointer-events-none absolute ${inline ? "right-0" : "right-2"} top-1/2 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded border border-border bg-secondary text-[10px] font-medium leading-none text-secondary-foreground opacity-0 shadow-md transition-opacity duration-150 data-[visible=true]:opacity-100`}
      />
    );
  },
);
