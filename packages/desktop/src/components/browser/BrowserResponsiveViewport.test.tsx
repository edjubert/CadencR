import { describe, expect, it } from "vitest";

import type { BrowserResponsiveGeometry } from "@/shared/browser-responsive";
import { transformBrowserPageBounds } from "./BrowserResponsiveViewport";

describe("responsive Browser overlay geometry", () => {
  it("maps page CSS boxes into the centered rendered viewport", () => {
    const geometry: BrowserResponsiveGeometry = {
      bounds: { x: 140, y: 12, width: 220, height: 476 },
      displayScale: 0.5,
      nativeScale: 0.5,
    };

    expect(transformBrowserPageBounds({ x: 20, y: 40, width: 100, height: 60 }, geometry)).toEqual({
      x: 150,
      y: 32,
      width: 50,
      height: 30,
    });
  });

  it("leaves normal Browser boxes unchanged", () => {
    const box = { x: 20, y: 40, width: 100, height: 60 };
    expect(transformBrowserPageBounds(box, null)).toBe(box);
  });
});
