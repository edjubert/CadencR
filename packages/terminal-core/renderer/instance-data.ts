/**
 * Converts the engine's packed grid into per-instance vertex data.
 *
 * Pure: no GPU, no canvas. This is where indexing and color bugs would live, so
 * it is kept testable without a browser.
 */

import { decodeColor } from "./palette";
import type { TextureRect } from "./atlas-layout";

/** Words per cell in the engine snapshot: char, foreground, background, flags. */
export const WORDS_PER_CELL = 4;

/**
 * Floats per instance:
 * `x, y` (cell coordinates)
 * `fgR/index, fgG, fgB, fgIsPalette`
 * `bgR/index, bgG, bgB, bgIsPalette`
 * `u0, v0, u1, v1` (glyph rect in the atlas)
 * `flags`
 */
export const FLOATS_PER_INSTANCE = 15;

/** The part of the atlas this module needs — kept narrow so tests can fake it. */
export interface GlyphSource {
  /**
   * Texture coordinates for a code point. Never throws: once the atlas is out
   * of room this returns a blank rect, because a missing glyph must not take
   * the render loop down with it.
   */
  glyph(codePoint: number): TextureRect;
  /** True once a glyph had to be dropped for lack of room. */
  readonly isFull: boolean;
  /** Drop every cached glyph. Called only when the atlas runs out of room. */
  reset(): void;
}

/**
 * Rasterize every code point in the grid before any texture coordinate is read.
 *
 * Texture coordinates are normalized against the atlas height, so a glyph
 * allocated late — which can grow the atlas — would invalidate every rect
 * handed out earlier in the same pass. Forcing all growth to happen up front
 * means `buildInstanceData` only ever hits cached slots, and every rect it
 * returns is normalized against the same, final height.
 *
 * An atlas that fills up mid-pass is reset once and the pass restarts, which
 * clears out glyphs from earlier screens that are no longer on this one. The
 * reset is skipped when the atlas was *already* full going in: that means the
 * previous frame already reset it and the grid genuinely holds more distinct
 * code points than the atlas can — resetting again every frame would rebuild
 * the whole atlas on every frame and fix nothing. In that case the overflow
 * renders blank and `isFull` stays set for the caller to surface.
 */
export function ensureGlyphs(packed: Uint32Array, atlas: GlyphSource): void {
  const wasFullBefore = atlas.isFull;
  rasterizeAll(packed, atlas);

  if (atlas.isFull && !wasFullBefore) {
    atlas.reset();
    rasterizeAll(packed, atlas);
  }
}

function rasterizeAll(packed: Uint32Array, atlas: GlyphSource): void {
  for (let word = 0; word < packed.length; word += WORDS_PER_CELL) {
    atlas.glyph(packed[word]);
  }
}

/**
 * Build the instance buffer for one frame.
 *
 * One instance per cell: the vertex shader expands each into a quad, so the
 * whole grid draws in a single instanced call rather than thousands of them.
 */
export function buildInstanceData(
  packed: Uint32Array,
  columns: number,
  lines: number,
  atlas: GlyphSource,
): Float32Array {
  const cells = columns * lines;
  if (packed.length !== cells * WORDS_PER_CELL) {
    throw new Error(
      `Snapshot holds ${packed.length / WORDS_PER_CELL} cells but the grid is ${columns}×${lines} = ${cells} cells`,
    );
  }

  const data = new Float32Array(cells * FLOATS_PER_INSTANCE);

  for (let cell = 0; cell < cells; cell += 1) {
    const source = cell * WORDS_PER_CELL;
    const target = cell * FLOATS_PER_INSTANCE;

    data[target] = cell % columns;
    data[target + 1] = Math.floor(cell / columns);

    writeColor(data, target + 2, packed[source + 1]);
    writeColor(data, target + 6, packed[source + 2]);

    const rect = atlas.glyph(packed[source]);
    data[target + 10] = rect.u0;
    data[target + 11] = rect.v0;
    data[target + 12] = rect.u1;
    data[target + 13] = rect.v1;

    data[target + 14] = packed[source + 3];
  }

  return data;
}

/**
 * Write one color as four floats. A palette color stores its index in the
 * first slot and sets the marker; a true color stores normalized rgb and
 * clears it. The shader branches on the marker.
 */
function writeColor(data: Float32Array, offset: number, packed: number): void {
  const color = decodeColor(packed);
  if (color.kind === "palette") {
    data[offset] = color.index;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 1;
    return;
  }
  data[offset] = color.r / 255;
  data[offset + 1] = color.g / 255;
  data[offset + 2] = color.b / 255;
  data[offset + 3] = 0;
}
