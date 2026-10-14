import { describe, expect, it } from "vitest";
import type { ManagedTab } from "./browser-tab-events";
import { browserScreenshotClipScale, captureScreenshotParams } from "./browser-screenshot";

function tab(options: { enabled: boolean; mobile: boolean; zoom: number }): ManagedTab {
  return {
    metadata: { responsive: { enabled: options.enabled, mobile: options.mobile } },
    webContents: { getZoomFactor: () => options.zoom },
  } as unknown as ManagedTab;
}

describe("captureScreenshotParams", () => {
  it("builds a positive CDP clip from an element bounding box", () => {
    expect(captureScreenshotParams({ x: -10.2, y: -20.7, width: 0, height: 32.3 })).toEqual({
      format: "png",
      clip: { x: 0, y: 0, width: 1, height: 32.3, scale: 1 },
    });
  });

  it("converts desktop CSS bounds to CDP DIP with page zoom, never fit scale", () => {
    expect(captureScreenshotParams({ x: 24, y: 25, width: 363.5, height: 37.5 }, 1.2)).toEqual({
      format: "png",
      clip: { x: expect.closeTo(28.8), y: 30, width: 436.2, height: 45, scale: 1 },
    });
    expect(browserScreenshotClipScale(tab({ enabled: true, mobile: false, zoom: 1.2 }))).toBe(1.2);
    expect(browserScreenshotClipScale(tab({ enabled: false, mobile: true, zoom: 1.2 }))).toBe(1.2);
  });

  it("keeps mobile responsive clip coordinates in CSS pixels", () => {
    expect(browserScreenshotClipScale(tab({ enabled: true, mobile: true, zoom: 1.2 }))).toBe(1);
  });
});
