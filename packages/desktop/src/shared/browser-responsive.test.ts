import { describe, expect, it } from "vitest";

import {
  browserPageBounds,
  DEFAULT_BROWSER_RESPONSIVE_STATE,
  fitBrowserResponsiveViewport,
  isValidBrowserResponsiveState,
  toBrowserResponsiveRequest,
  type BrowserResponsiveState,
} from "./browser-responsive";

function enabled(overrides: Partial<BrowserResponsiveState> = {}): BrowserResponsiveState {
  return { ...DEFAULT_BROWSER_RESPONSIVE_STATE, enabled: true, ...overrides };
}

describe("Browser responsive geometry", () => {
  it("uses the same docked DevTools page reservation as native layout", () => {
    expect(browserPageBounds({ x: 10, y: 20, width: 900, height: 701 }, true)).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 434,
    });
    expect(browserPageBounds({ x: 10, y: 20, width: 900, height: 701 }, false)).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 701,
    });
  });

  it("centers an unscaled viewport when it fits", () => {
    expect(
      fitBrowserResponsiveViewport(
        { x: 100, y: 40, width: 700, height: 900 },
        enabled({ width: 390, height: 844 }),
      ),
    ).toEqual({
      bounds: { x: 255, y: 68, width: 390, height: 844 },
      displayScale: 1,
      nativeScale: 1,
    });
  });

  it("fits a tall viewport with a gutter and never upscales renderer CSS", () => {
    const result = fitBrowserResponsiveViewport(
      { x: 0, y: 0, width: 500, height: 500 },
      enabled({ width: 390, height: 844 }),
    );
    expect(result.displayScale).toBeCloseTo(476 / 844);
    expect(result.nativeScale).toBeCloseTo(476 / 844);
    expect(result.bounds).toEqual({ x: 140, y: 12, width: 220, height: 476 });
  });

  it("keeps renderer and native geometry exact under app UI zoom", () => {
    const renderer = fitBrowserResponsiveViewport(
      { x: 20, y: 30, width: 500, height: 400 },
      enabled({ width: 390, height: 844 }),
    );
    const native = fitBrowserResponsiveViewport(
      { x: 25, y: 37.5, width: 625, height: 500 },
      enabled({ width: 390, height: 844 }),
      1.25,
    );
    expect(native.displayScale).toBeCloseTo(renderer.displayScale);
    expect(native.nativeScale).toBeCloseTo(renderer.displayScale * 1.25);
    expect(Math.abs(native.bounds.x - renderer.bounds.x * 1.25)).toBeLessThanOrEqual(1);
    expect(Math.abs(native.bounds.width - renderer.bounds.width * 1.25)).toBeLessThanOrEqual(1);
  });

  it("leaves normal Browser bounds untouched", () => {
    const bounds = { x: 12, y: 24, width: 900, height: 600 };
    expect(fitBrowserResponsiveViewport(bounds, DEFAULT_BROWSER_RESPONSIVE_STATE, 1.4)).toEqual({
      bounds,
      displayScale: 1,
      nativeScale: 1.4,
    });
  });
});

describe("Browser responsive validation", () => {
  it("accepts bounded presets and rejects excessive dimensions or surface", () => {
    expect(isValidBrowserResponsiveState(enabled())).toBe(true);
    expect(isValidBrowserResponsiveState(enabled({ width: 239 }))).toBe(false);
    expect(isValidBrowserResponsiveState(enabled({ width: 2_560, height: 2_560 }))).toBe(false);
    expect(isValidBrowserResponsiveState(enabled({ deviceScaleFactor: 4 }))).toBe(false);
  });

  it("extracts the exact request contract without native status", () => {
    expect(toBrowserResponsiveRequest(enabled({ status: "error" }))).toEqual({
      enabled: true,
      preset: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      colorScheme: "system",
    });
  });
});
