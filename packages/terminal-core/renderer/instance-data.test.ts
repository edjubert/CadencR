import { describe, expect, it } from "vitest";
import { FLOATS_PER_INSTANCE, buildInstanceData } from "./instance-data";
import { WORDS_PER_CELL } from "./instance-data";

function snapshot(cells: Array<[number, number, number, number]>): Uint32Array {
  const packed = new Uint32Array(cells.length * WORDS_PER_CELL);
  cells.forEach((cell, index) => packed.set(cell, index * WORDS_PER_CELL));
  return packed;
}

const atlas = {
  glyph: () => ({ u0: 0, v0: 0, u1: 0.5, v1: 0.5 }),
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
