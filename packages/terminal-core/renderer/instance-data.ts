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
  glyph(codePoint: number): TextureRect;
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
