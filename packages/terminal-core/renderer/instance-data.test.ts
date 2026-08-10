import { describe, expect, it } from "vitest";
import { FLOATS_PER_INSTANCE, buildInstanceData, ensureGlyphs } from "./instance-data";
import { WORDS_PER_CELL } from "./instance-data";
import { AtlasLayout } from "./atlas-layout";

function snapshot(cells: Array<[number, number, number, number]>): Uint32Array {
  const packed = new Uint32Array(cells.length * WORDS_PER_CELL);
  cells.forEach((cell, index) => packed.set(cell, index * WORDS_PER_CELL));
  return packed;
}

const atlas = {
  glyph: () => ({ u0: 0, v0: 0, u1: 0.5, v1: 0.5 }),
  reset: () => {},
};

describe("buildInstanceData", () => {
  it("emits one instance per cell", () => {
    const packed = snapshot([
      [65, (1 << 24) | 256, (1 << 24) | 257, 0],
      [66, (1 << 24) | 256, (1 << 24) | 257, 0],
    ]);
    const data = buildInstanceData(packed, 2, 1, atlas);
    expect(data.length).toBe(2 * FLOATS_PER_INSTANCE);
  });

  it("places cells by row and column", () => {
    const packed = snapshot([
      [65, (1 << 24) | 256, (1 << 24) | 257, 0],
      [66, (1 << 24) | 256, (1 << 24) | 257, 0],
      [67, (1 << 24) | 256, (1 << 24) | 257, 0],
      [68, (1 << 24) | 256, (1 << 24) | 257, 0],
    ]);
    const data = buildInstanceData(packed, 2, 2, atlas);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[FLOATS_PER_INSTANCE]).toBe(1);
    expect(data[FLOATS_PER_INSTANCE + 1]).toBe(0);
    expect(data[FLOATS_PER_INSTANCE * 2]).toBe(0);
    expect(data[FLOATS_PER_INSTANCE * 2 + 1]).toBe(1);
  });

  it("marks a palette color so the shader resolves it, and passes rgb through", () => {
    const packed = snapshot([[65, (1 << 24) | 3, (2 << 24) | 0x102030, 0]]);
    const data = buildInstanceData(packed, 1, 1, atlas);

    const fgIsPalette = data[5];
    const fgIndex = data[2];
    expect(fgIsPalette).toBe(1);
    expect(fgIndex).toBe(3);

    const bgIsPalette = data[9];
    expect(bgIsPalette).toBe(0);
    expect(data[6]).toBeCloseTo(0x10 / 255);
    expect(data[7]).toBeCloseTo(0x20 / 255);
    expect(data[8]).toBeCloseTo(0x30 / 255);
  });

  it("passes the flags word through so the shader can invert", () => {
    const INVERSE = 1;
    const packed = snapshot([[65, (1 << 24) | 256, (1 << 24) | 257, INVERSE]]);
    const data = buildInstanceData(packed, 1, 1, atlas);
    expect(data[FLOATS_PER_INSTANCE - 1]).toBe(INVERSE);
  });

  it("rejects a snapshot whose size does not match the grid", () => {
    const packed = snapshot([[65, (1 << 24) | 256, (1 << 24) | 257, 0]]);
    expect(() => buildInstanceData(packed, 4, 4, atlas)).toThrow(/16 cells/);
  });
});

describe("ensureGlyphs", () => {
  /** A layout-backed atlas, so growth really does renormalize coordinates. */
  function growingAtlas(cell = { width: 8, height: 17 }, width = 16) {
    const layout = new AtlasLayout(cell, width);
    return {
      layout,
      glyph: (codePoint: number) => layout.uvFor(layout.slotFor(codePoint)),
      reset: () => layout.reset(),
    };
  }

  /** A cell carrying a valid palette foreground and background. */
  function cellFor(codePoint: number): [number, number, number, number] {
    return [codePoint, (1 << 24) | 256, (1 << 24) | 257, 0];
  }

  it("makes every texture coordinate outlive the growth it triggers", () => {
    const atlas = growingAtlas();
    // Enough distinct code points to force several growths.
    const cells: Array<[number, number, number, number]> = [];
    for (let code = 65; code < 105; code += 1) cells.push(cellFor(code));
    const packed = snapshot(cells);

    ensureGlyphs(packed, atlas);
    const heightAfterEnsure = atlas.layout.height;
    const first = atlas.glyph(65);
    buildInstanceData(packed, cells.length, 1, atlas);

    expect(atlas.layout.height).toBe(heightAfterEnsure);
    expect(atlas.glyph(65)).toEqual(first);
  });

  it("resets and refills instead of throwing when the atlas fills up", () => {
    // One glyph per row makes the 8192px ceiling reachable: 481 slots.
    const atlas = growingAtlas({ width: 8, height: 17 }, 8);
    // Leave the atlas nearly full, the way a long-lived terminal would.
    for (let code = 1000; code < 1450; code += 1) atlas.glyph(code);

    // A screen holding fewer distinct glyphs than the atlas can hold, so the
    // refill after the reset always fits.
    const cells: Array<[number, number, number, number]> = [];
    for (let code = 0; code < 300; code += 1) cells.push(cellFor(code));
    const packed = snapshot(cells);

    expect(() => ensureGlyphs(packed, atlas)).not.toThrow();
    expect(() => buildInstanceData(packed, cells.length, 1, atlas)).not.toThrow();
  });
});
