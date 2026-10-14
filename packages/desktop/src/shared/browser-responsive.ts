import type { BrowserBounds } from "./browser-types";

export const BROWSER_RESPONSIVE_PRESETS = ["desktop", "tablet", "mobile", "custom"] as const;
export type BrowserResponsivePreset = (typeof BROWSER_RESPONSIVE_PRESETS)[number];

export const BROWSER_RESPONSIVE_COLOR_SCHEMES = ["system", "light", "dark"] as const;
export type BrowserResponsiveColorScheme = (typeof BROWSER_RESPONSIVE_COLOR_SCHEMES)[number];

export const MIN_BROWSER_RESPONSIVE_DIMENSION = 240;
export const MAX_BROWSER_RESPONSIVE_DIMENSION = 2_560;
export const MAX_BROWSER_RESPONSIVE_SURFACE = 4_000_000;
export const MAX_BROWSER_RESPONSIVE_DPR = 3;
export const BROWSER_RESPONSIVE_FRAME_GUTTER = 12;
export const BROWSER_DEVTOOLS_PAGE_RATIO = 0.62;

export interface BrowserResponsiveRequest {
  enabled: boolean;
  preset: BrowserResponsivePreset;
  width: number;
  height: number;
  deviceScaleFactor: number;
  /** Chromium mobile viewport metrics; independent from touch event emulation. */
  mobile: boolean;
  touch: boolean;
  colorScheme: BrowserResponsiveColorScheme;
}

export interface BrowserResponsiveState extends BrowserResponsiveRequest {
  /** `error` means native rollback or cleanup could not be confirmed. */
  status: "ready" | "error";
}

export const DEFAULT_BROWSER_RESPONSIVE_STATE: BrowserResponsiveState = {
  enabled: false,
  preset: "mobile",
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  touch: true,
  colorScheme: "system",
  status: "ready",
};

export interface BrowserResponsiveGeometry {
  /** Native/renderer rectangle occupied by the live page, in `bounds` coordinates. */
  bounds: BrowserBounds;
  /** CSS-page pixel to renderer-CSS-pixel ratio (used by snapshots and overlays). */
  displayScale: number;
  /** CSS-page pixel to native-DIP ratio (used by device emulation and native input). */
  nativeScale: number;
}

/** The page occupies the upper 62% of the viewport while docked DevTools is open. */
export function browserPageBounds(bounds: BrowserBounds, devToolsOpen: boolean): BrowserBounds {
  return devToolsOpen
    ? { ...bounds, height: Math.max(1, Math.floor(bounds.height * BROWSER_DEVTOOLS_PAGE_RATIO)) }
    : bounds;
}

/**
 * Fit a responsive page into a host rectangle without upscaling it in renderer
 * coordinates. `coordinateScale` converts renderer CSS pixels to the coordinate
 * system of `bounds` (the main process passes the app UI zoom factor).
 */
export function fitBrowserResponsiveViewport(
  bounds: BrowserBounds,
  state: BrowserResponsiveState,
  coordinateScale = 1,
): BrowserResponsiveGeometry {
  const safeCoordinateScale =
    coordinateScale > 0 && Number.isFinite(coordinateScale) ? coordinateScale : 1;
  if (!state.enabled) {
    return { bounds, displayScale: 1, nativeScale: safeCoordinateScale };
  }
  const gutter = BROWSER_RESPONSIVE_FRAME_GUTTER * safeCoordinateScale;
  const availableWidth = Math.max(1, bounds.width - gutter * 2);
  const availableHeight = Math.max(1, bounds.height - gutter * 2);
  const nativeScale = Math.min(
    safeCoordinateScale,
    availableWidth / state.width,
    availableHeight / state.height,
  );
  // Round the fitted size to the nearest native pixel. The continuous size is
  // already bounded by the integer available extent, so rounding cannot
  // overflow it and avoids losing a pixel to floating-point underflow (for
  // example, `390 * (476 / 844)` evaluates just below `220`).
  const width = Math.max(1, Math.round(state.width * nativeScale));
  const height = Math.max(1, Math.round(state.height * nativeScale));
  return {
    bounds: {
      x: bounds.x + Math.floor((bounds.width - width) / 2),
      y: bounds.y + Math.floor((bounds.height - height) / 2),
      width,
      height,
    },
    displayScale: nativeScale / safeCoordinateScale,
    nativeScale,
  };
}

export function isValidBrowserResponsiveState(
  state: BrowserResponsiveRequest,
): state is BrowserResponsiveRequest {
  const dimensions = [state.width, state.height, state.deviceScaleFactor];
  return (
    dimensions.every(Number.isFinite) &&
    Number.isInteger(state.width) &&
    Number.isInteger(state.height) &&
    state.width >= MIN_BROWSER_RESPONSIVE_DIMENSION &&
    state.height >= MIN_BROWSER_RESPONSIVE_DIMENSION &&
    state.width <= MAX_BROWSER_RESPONSIVE_DIMENSION &&
    state.height <= MAX_BROWSER_RESPONSIVE_DIMENSION &&
    state.width * state.height <= MAX_BROWSER_RESPONSIVE_SURFACE &&
    state.deviceScaleFactor >= 1 &&
    state.deviceScaleFactor <= MAX_BROWSER_RESPONSIVE_DPR &&
    BROWSER_RESPONSIVE_PRESETS.includes(state.preset) &&
    BROWSER_RESPONSIVE_COLOR_SCHEMES.includes(state.colorScheme)
  );
}

export function cloneBrowserResponsiveState(state: BrowserResponsiveState): BrowserResponsiveState {
  return { ...state };
}

export function responsiveStateFromRequest(
  request: BrowserResponsiveRequest,
): BrowserResponsiveState {
  return { ...request, status: "ready" };
}

/** Strip main-process status before a renderer request crosses the strict IPC boundary. */
export function toBrowserResponsiveRequest(
  state: BrowserResponsiveState,
): BrowserResponsiveRequest {
  const { enabled, preset, width, height, deviceScaleFactor, mobile, touch, colorScheme } = state;
  return { enabled, preset, width, height, deviceScaleFactor, mobile, touch, colorScheme };
}
