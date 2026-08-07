/** Public surface of the terminal renderer. */

export { AtlasLayout } from "./atlas-layout";
export type { AtlasSlot, CellMetrics, TextureRect } from "./atlas-layout";
export { GlyphAtlas, measureCell } from "./atlas";
export type { FontSpec } from "./atlas";
export { buildInstanceData, FLOATS_PER_INSTANCE, WORDS_PER_CELL } from "./instance-data";
export type { GlyphSource } from "./instance-data";
export { buildPaletteBuffer, decodeColor, PALETTE_ENTRIES } from "./palette";
export type { DecodedColor } from "./palette";
export { TerminalRenderer } from "./renderer";
export type { AtlasTexture, RendererGrid } from "./renderer";
