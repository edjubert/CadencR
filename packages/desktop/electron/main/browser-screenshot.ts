import type { ManagedTab } from "./browser-tab-events";

interface BrowserScreenshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CDP clip coordinates are native DIP for desktop pages, but CSS pixels in mobile emulation. */
export function browserScreenshotClipScale(tab: ManagedTab): number {
  if (tab.metadata.responsive.enabled && tab.metadata.responsive.mobile) return 1;
  const zoom = tab.webContents.getZoomFactor();
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function captureScreenshotParams(
  bounds?: BrowserScreenshotBounds,
  coordinateScale = 1,
): Record<string, unknown> {
  if (!bounds) return { format: "png" };
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1;
  return {
    format: "png",
    clip: {
      x: Math.max(0, bounds.x * scale),
      y: Math.max(0, bounds.y * scale),
      width: Math.max(1, bounds.width * scale),
      height: Math.max(1, bounds.height * scale),
      scale: 1,
    },
  };
}
