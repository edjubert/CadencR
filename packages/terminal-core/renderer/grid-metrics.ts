/**
 * Conversions between CSS pixels, physical pixels and grid cells.
 *
 * Pure arithmetic, kept out of the DOM code: rounding and DPI mistakes here are
 * invisible to the eye until you compare numbers, so they get tests.
 */

import type { CellMetrics } from "./atlas-layout";

export interface CssSize {
  cssWidth: number;
  cssHeight: number;
}

export interface GridSize {
  columns: number;
  lines: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * How many whole cells fit in a surface.
 *
 * Cell metrics are already in physical pixels, so the CSS size is scaled by the
 * device pixel ratio first. Partial cells are floored — a clipped half-row
 * looks like a rendering bug. Never returns zero: a collapsed panel would
 * otherwise ask the engine for a grid it cannot represent.
 */
export function gridSizeFor(size: CssSize, cell: CellMetrics, devicePixelRatio: number): GridSize {
  const { width, height } = pixelSizeFor(size, devicePixelRatio);
  return {
    columns: Math.max(1, Math.floor(width / cell.width)),
    lines: Math.max(1, Math.floor(height / cell.height)),
  };
}

/** Physical pixel dimensions for a CSS-sized surface. */
export function pixelSizeFor(size: CssSize, devicePixelRatio: number): PixelSize {
  return {
    width: Math.round(size.cssWidth * devicePixelRatio),
    height: Math.round(size.cssHeight * devicePixelRatio),
  };
}

/** The cell under a pointer position given in CSS pixels, relative to the canvas. */
export function cellAtPixel(
  position: { x: number; y: number },
  cell: CellMetrics,
  devicePixelRatio: number,
): { column: number; line: number } {
  return {
    column: Math.max(0, Math.floor((position.x * devicePixelRatio) / cell.width)),
    line: Math.max(0, Math.floor((position.y * devicePixelRatio) / cell.height)),
  };
}
