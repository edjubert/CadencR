/**
 * Public surface of the terminal renderer.
 *
 * The WebGPU pipeline is added here in a later task; for now the package
 * exports the glyph atlas and its layout.
 */

export { AtlasLayout } from "./atlas-layout";
export type { AtlasSlot, CellMetrics, TextureRect } from "./atlas-layout";
export { GlyphAtlas, measureCell } from "./atlas";
export type { FontSpec } from "./atlas";
