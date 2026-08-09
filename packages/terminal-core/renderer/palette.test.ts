import { describe, expect, it } from "vitest";
import { PALETTE_ENTRIES, buildPaletteBuffer, decodeColor } from "./palette";

describe("decodeColor", () => {
  it("recognizes a palette index", () => {
    const decoded = decodeColor((1 << 24) | 5);
    expect(decoded).toEqual({ kind: "palette", index: 5 });
  });

  it("recognizes the named slots above the 8-bit palette", () => {
    const decoded = decodeColor((1 << 24) | 256);
    expect(decoded).toEqual({ kind: "palette", index: 256 });
  });

  it("recognizes a true-color value", () => {
    const decoded = decodeColor((2 << 24) | 0x123456);
    expect(decoded).toEqual({ kind: "rgb", r: 0x12, g: 0x34, b: 0x56 });
  });
});

describe("buildPaletteBuffer", () => {
  it("produces four floats per palette entry", () => {
    const buffer = buildPaletteBuffer(new Map());
    expect(buffer.length).toBe(PALETTE_ENTRIES * 4);
  });

  it("writes overrides as normalized rgba", () => {
    const buffer = buildPaletteBuffer(new Map([[1, "#ff8000"]]));
    expect(buffer[4]).toBeCloseTo(1);
    expect(buffer[5]).toBeCloseTo(0x80 / 255);
    expect(buffer[6]).toBeCloseTo(0);
    expect(buffer[7]).toBeCloseTo(1);
  });

  it("rejects a malformed color rather than drawing something wrong", () => {
    expect(() => buildPaletteBuffer(new Map([[0, "not-a-color"]]))).toThrow(/not-a-color/);
  });
});
