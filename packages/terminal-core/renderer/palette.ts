/**
 * Theme colors, and the decoding of the packed colors the wasm engine emits.
 *
 * The palette lives in a uniform buffer the shader resolves against, so
 * changing theme rewrites this buffer and nothing else — in particular it never
 * rebuilds the glyph atlas, which stores coverage only.
 */

/**
 * 256 indexed colors plus alacritty's named slots (default foreground,
 * background, cursor, and the dim/bright variants), which start at 256.
 */
export const PALETTE_ENTRIES = 288;

export type DecodedColor =
  | { kind: "palette"; index: number }
  | { kind: "rgb"; r: number; g: number; b: number };

const TAG_MASK = 0xff00_0000;
const TAG_PALETTE = 1 << 24;
const TAG_RGB = 2 << 24;
const PAYLOAD_MASK = 0x00ff_ffff;

/**
 * Decode one packed color word from the engine's snapshot.
 *
 * The high byte tags the kind and the low 24 bits carry the payload. The
 * payload is 24 bits rather than 8 because the named slots start at 256 —
 * an 8-bit payload would truncate the default foreground, the most common
 * color of all.
 */
export function decodeColor(packed: number): DecodedColor {
  const tag = packed & TAG_MASK;
  const payload = packed & PAYLOAD_MASK;

  if (tag === TAG_RGB) {
    return {
      kind: "rgb",
      r: (payload >> 16) & 0xff,
      g: (payload >> 8) & 0xff,
      b: payload & 0xff,
    };
  }

  if (tag === TAG_PALETTE) {
    return { kind: "palette", index: payload };
  }

  throw new Error(`Unknown color tag in packed color 0x${packed.toString(16)}`);
}

/**
 * Build the palette uniform buffer: four floats (rgba, 0..1) per entry.
 *
 * `overrides` maps a palette index to a `#rrggbb` color from the active theme;
 * unspecified entries stay opaque black, which is visible rather than
 * transparent so a missing theme entry shows up instead of silently vanishing.
 */
export function buildPaletteBuffer(overrides: Map<number, string>): Float32Array {
  const buffer = new Float32Array(PALETTE_ENTRIES * 4);

  for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
    buffer[index * 4 + 3] = 1;
  }

  for (const [index, color] of overrides) {
    if (index < 0 || index >= PALETTE_ENTRIES) {
      throw new Error(`Palette index ${index} is outside 0..${PALETTE_ENTRIES - 1}`);
    }
    const { r, g, b } = parseHexColor(color);
    buffer[index * 4] = r / 255;
    buffer[index * 4 + 1] = g / 255;
    buffer[index * 4 + 2] = b / 255;
    buffer[index * 4 + 3] = 1;
  }

  return buffer;
}

function parseHexColor(color: string): { r: number; g: number; b: number } {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (match === null) {
    throw new Error(`Expected a #rrggbb color, got "${color}"`);
  }
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}
