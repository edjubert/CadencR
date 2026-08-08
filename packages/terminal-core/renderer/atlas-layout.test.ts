import { describe, expect, it } from "vitest";
import { AtlasLayout } from "./atlas-layout";

const CELL = { width: 8, height: 17 };

describe("AtlasLayout", () => {
  it("assigns a distinct slot to each new code point", () => {
    const layout = new AtlasLayout(CELL, 256);
    const a = layout.slotFor("a".codePointAt(0)!);
    const b = layout.slotFor("b".codePointAt(0)!);
    expect(a.index).not.toBe(b.index);
  });

  it("returns the same slot for a code point it already holds", () => {
    const layout = new AtlasLayout(CELL, 256);
    const first = layout.slotFor("x".codePointAt(0)!);
    const second = layout.slotFor("x".codePointAt(0)!);
    expect(second.index).toBe(first.index);
    expect(second.isNew).toBe(false);
    expect(first.isNew).toBe(true);
  });

  it("reports slots as new only on first sight, so the caller knows when to rasterize", () => {
    const layout = new AtlasLayout(CELL, 256);
    expect(layout.slotFor(65).isNew).toBe(true);
    expect(layout.slotFor(65).isNew).toBe(false);
  });

  it("lays slots out in rows across the texture", () => {
    // 128px wide / 8px cells = 16 columns per row.
    const layout = new AtlasLayout(CELL, 128);
    expect(layout.columns).toBe(16);

    const first = layout.slotFor(65);
    expect(first.x).toBe(0);
    expect(first.y).toBe(0);

    // The 17th glyph wraps onto the second row.
    for (let code = 66; code < 65 + 16; code += 1) layout.slotFor(code);
    const wrapped = layout.slotFor(65 + 16);
    expect(wrapped.x).toBe(0);
    expect(wrapped.y).toBe(CELL.height);
  });

  it("grows the texture height as rows fill up", () => {
    const layout = new AtlasLayout(CELL, 128);
    const initialHeight = layout.height;
    // Fill well beyond the first row.
    for (let code = 0; code < 100; code += 1) layout.slotFor(code);
    expect(layout.height).toBeGreaterThan(initialHeight);
  });

  it("exposes normalized texture coordinates for a slot", () => {
    const layout = new AtlasLayout(CELL, 128);
    const slot = layout.slotFor(65);
    const uv = layout.uvFor(slot);
    expect(uv.u0).toBe(0);
    expect(uv.v0).toBe(0);
    expect(uv.u1).toBeCloseTo(CELL.width / layout.width);
    expect(uv.v1).toBeCloseTo(CELL.height / layout.height);
  });

  it("rejects a zero-sized cell rather than producing a degenerate atlas", () => {
    expect(() => new AtlasLayout({ width: 0, height: 17 }, 128)).toThrow(/cell width/i);
  });
});
