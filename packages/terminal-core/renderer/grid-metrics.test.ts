import { describe, expect, it } from "vitest";
import { gridSizeFor, pixelSizeFor, cellAtPixel } from "./grid-metrics";

const CELL = { width: 8, height: 17 };

describe("gridSizeFor", () => {
  it("divides the physical surface by the cell size", () => {
    // 800 CSS px at dpr 1 → 100 columns of 8px.
    expect(gridSizeFor({ cssWidth: 800, cssHeight: 340 }, CELL, 1)).toEqual({
      columns: 100,
      lines: 20,
    });
  });

  it("accounts for device pixel ratio", () => {
    // The cell size is already in physical pixels, so a dpr of 2 doubles the
    // physical surface and therefore the number of cells that fit.
    expect(gridSizeFor({ cssWidth: 800, cssHeight: 340 }, CELL, 2)).toEqual({
      columns: 200,
      lines: 40,
    });
  });

  it("floors partial cells rather than showing a clipped one", () => {
    expect(gridSizeFor({ cssWidth: 803, cssHeight: 345 }, CELL, 1)).toEqual({
      columns: 100,
      lines: 20,
    });
  });

  it("never reports a zero-sized grid, which no engine can represent", () => {
    expect(gridSizeFor({ cssWidth: 0, cssHeight: 0 }, CELL, 1)).toEqual({
      columns: 1,
      lines: 1,
    });
  });
});

describe("pixelSizeFor", () => {
  it("returns the physical pixel dimensions of the canvas", () => {
    expect(pixelSizeFor({ cssWidth: 800, cssHeight: 340 }, 2)).toEqual({
      width: 1600,
      height: 680,
    });
  });
});

describe("cellAtPixel", () => {
  it("maps a CSS-pixel position onto a zero-indexed cell", () => {
    // 20 CSS px at dpr 1 with an 8px cell → column 2.
    expect(cellAtPixel({ x: 20, y: 20 }, CELL, 1)).toEqual({ column: 2, line: 1 });
  });

  it("accounts for device pixel ratio", () => {
    expect(cellAtPixel({ x: 20, y: 20 }, CELL, 2)).toEqual({ column: 5, line: 2 });
  });

  it("clamps a negative position to the first cell", () => {
    expect(cellAtPixel({ x: -5, y: -5 }, CELL, 1)).toEqual({ column: 0, line: 0 });
  });
});
