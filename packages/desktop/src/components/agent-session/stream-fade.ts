import type { CSSProperties } from "react";

/**
 * Height of the strip where the transcript dissolves into the composer.
 *
 * The strip ends ON the scroll container's bottom edge — that edge is where
 * Virtuoso clips, so it is the only line where a message can be sliced in half.
 * Padding on the stream wrapper would push the clip edge above the strip and the
 * fade would have nothing to act on.
 */
export const STREAM_FADE_PX = 32;

/**
 * Blank space below the last item, inside the scroller.
 *
 * Bigger than the strip so a settled transcript ends clear of it. Because this
 * is scrollable-but-empty it also has to be forgiven by every "are we at the
 * bottom?" check — see `STREAM_AT_BOTTOM_THRESHOLD_PX` and `maybeFillViewport`.
 */
export const STREAM_BOTTOM_GAP_PX = 40;

/**
 * Virtuoso's at-bottom slack: the spacer plus the measurement tolerance it used
 * to run with on its own. Resting on the last message *is* the bottom; without
 * the spacer folded in, `scrollToIndex({ align: "end" })` stops one spacer short
 * of `scrollHeight` and the "scroll to bottom" chip shows itself on every cold
 * open on iOS, where the raw follow-up pin is deliberately skipped.
 */
export const STREAM_AT_BOTTOM_THRESHOLD_PX = STREAM_BOTTOM_GAP_PX + 16;

// Ease-out, weighted to the last third: the transcript stays fully legible for
// most of the strip and only lets go right at the edge.
const DISSOLVE_MASK =
  "linear-gradient(to bottom," +
  ` #000 calc(100% - ${STREAM_FADE_PX}px),` +
  ` rgba(0, 0, 0, 0.55) calc(100% - ${Math.round(STREAM_FADE_PX * 0.55)}px),` +
  ` rgba(0, 0, 0, 0.16) calc(100% - ${Math.round(STREAM_FADE_PX * 0.22)}px),` +
  " transparent 100%)";

/**
 * Fades the transcript out at its own bottom edge, for the stream wrapper. This
 * is the whole transition — nothing is painted on top of it, by design.
 *
 * A mask, not a scrim and not a blur band. Both of those were tried and both put
 * a hard horizontal line under the chips:
 *
 *  - a gradient to `var(--background)` can only be as opaque as the token, and
 *    frost's is `oklch(... / 0.55)` — so the strip stayed see-through AND read
 *    darker than the page it sat on;
 *  - a `backdrop-filter` band has to end somewhere, and `blur(28px)
 *    saturate(150%)` over the ambient field is visibly lighter than the same
 *    field unfiltered, so wherever it ended you saw the seam. It also had
 *    nothing to earn: below the clip edge only the flat ambient field paints —
 *    exactly why theme-frost.css strips the prompt bar's own blur — and above it
 *    the content is already dissolving.
 *
 * A mask has no colour and no filter of its own, so what shows through is the
 * page, pixel-identical to the page one row lower. That is the only way this
 * transition can be seamless in a theme whose `--background` is translucent.
 */
export const STREAM_DISSOLVE_STYLE: CSSProperties = {
  maskImage: DISSOLVE_MASK,
  WebkitMaskImage: DISSOLVE_MASK,
};
