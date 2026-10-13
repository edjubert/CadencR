import { describe, expect, it } from "vitest";
import type { Display } from "electron";
import { parseNotchProbe, resolveNotchPlacement } from "./notch-geometry";

function display(
  id: number,
  bounds: { x: number; y: number; width: number; height: number },
  menuBar: number,
  internal: boolean,
): Display {
  return {
    id,
    bounds,
    workArea: { ...bounds, y: bounds.y + menuBar, height: bounds.height - menuBar },
    internal,
  } as Display;
}

const builtIn = display(1, { x: 0, y: 0, width: 2056, height: 1329 }, 39, true);
const external = display(2, { x: 2056, y: -200, width: 2560, height: 1440 }, 25, false);

describe("parseNotchProbe", () => {
  it("keeps only notched screens and derives the cutout", () => {
    const probed = parseNotchProbe(
      JSON.stringify([
        { x: 0, y: 0, width: 2056, height: 1329, top: 38, leftEnd: 918, rightStart: 1138 },
        { x: 2056, y: 89, width: 2560, height: 1440, top: 0, leftEnd: 0, rightStart: 0 },
      ]),
    );
    expect(probed).toEqual([
      { x: 0, y: 0, width: 2056, height: 1329, notchWidth: 220, notchHeight: 38 },
    ]);
  });

  it("rejects unexpected output", () => {
    expect(() => parseNotchProbe('{"nope":1}')).toThrow();
  });
});

describe("resolveNotchPlacement", () => {
  it("hugs the probed hardware notch, matching Cocoa coordinates", () => {
    const placement = resolveNotchPlacement([external, builtIn], builtIn, [
      { x: 0, y: 0, width: 2056, height: 1329, notchWidth: 220, notchHeight: 38 },
    ]);
    expect(placement).toMatchObject({ notchWidth: 220, notchHeight: 38, hardware: true });
    expect(placement.display.id).toBe(1);
  });

  it("falls back to the menu-bar heuristic when the probe could not run", () => {
    const placement = resolveNotchPlacement([external, builtIn], external, null);
    expect(placement).toMatchObject({ hardware: true, notchHeight: 39 });
    expect(placement.display.id).toBe(1);
  });

  it("draws a virtual notch on the primary display when nothing is notched", () => {
    const placement = resolveNotchPlacement([external], external, []);
    expect(placement).toMatchObject({ hardware: false, notchHeight: 25 });
    expect(placement.display.id).toBe(2);
  });
});
