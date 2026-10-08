import type { WebContents } from "electron";

import type { BrowserResponsiveState } from "./browser-types";

export async function applyResponsiveOverrides(
  webContents: WebContents,
  state: BrowserResponsiveState,
  nativeScale: number,
): Promise<void> {
  if (webContents.isDestroyed()) throw new Error("Browser tab closed during responsive update.");
  if (!state.enabled) {
    const cleanupError = await clearResponsiveOverrides(webContents);
    if (cleanupError) throw cleanupError;
    return;
  }
  await applyResponsiveProtocolOverrides(webContents, state, nativeScale);
}

export function responsiveDeviceMetricsParams(
  state: BrowserResponsiveState,
  nativeScale: number,
  pageZoom: number,
): Record<string, unknown> {
  const zoom = validScale(pageZoom);
  return {
    width: state.mobile ? state.width : Math.ceil(state.width * zoom),
    height: state.mobile ? state.height : Math.ceil(state.height * zoom),
    deviceScaleFactor: state.mobile ? state.deviceScaleFactor : state.deviceScaleFactor / zoom,
    mobile: state.mobile,
    scale: state.mobile ? nativeScale : nativeScale / zoom,
    screenWidth: state.width,
    screenHeight: state.height,
    positionX: 0,
    positionY: 0,
  };
}

/** Attempts every cleanup step so a partial protocol failure cannot leave device metrics behind. */
export async function clearResponsiveOverrides(webContents: WebContents): Promise<Error | null> {
  try {
    return await clearResponsiveProtocolOverrides(webContents);
  } catch (error) {
    return new AggregateError([error], "Could not clear all responsive overrides.");
  }
}

async function clearResponsiveProtocolOverrides(webContents: WebContents): Promise<Error | null> {
  const debug = webContents.debugger;
  const errors: unknown[] = [];
  try {
    if (!debug.isAttached()) debug.attach("1.3");
  } catch (error) {
    errors.push(error);
  }
  const commands: Array<[string, Record<string, unknown>]> = [
    ["Emulation.clearDeviceMetricsOverride", {}],
    ["Emulation.setTouchEmulationEnabled", { enabled: false }],
    ["Emulation.setEmitTouchEventsForMouse", { enabled: false, configuration: "desktop" }],
    ["Emulation.setEmulatedMedia", { media: "", features: [] }],
  ];
  for (const [command, parameters] of commands) {
    try {
      await debug.sendCommand(command, parameters);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 0) return null;
  return new AggregateError(errors, "Could not clear all responsive protocol overrides.");
}

export async function applyResponsiveProtocolOverrides(
  webContents: WebContents,
  state: BrowserResponsiveState,
  nativeScale: number,
): Promise<void> {
  const debug = webContents.debugger;
  if (!debug.isAttached()) debug.attach("1.3");
  // Keep metrics on the same CDP authority as Page.captureScreenshot. Mixing
  // Electron's enableDeviceEmulation with CDP capture makes Chromium restore a
  // stale metrics snapshot after a crop, reflowing the live page.
  await debug.sendCommand(
    "Emulation.setDeviceMetricsOverride",
    responsiveDeviceMetricsParams(state, nativeScale, webContents.getZoomFactor()),
  );
  const touch = state.enabled && state.touch;
  await debug.sendCommand(
    "Emulation.setTouchEmulationEnabled",
    touch ? { enabled: true, maxTouchPoints: 1 } : { enabled: false },
  );
  await debug.sendCommand("Emulation.setEmitTouchEventsForMouse", {
    enabled: touch,
    configuration: touch ? "mobile" : "desktop",
  });
  await debug.sendCommand("Emulation.setEmulatedMedia", {
    media: "",
    features:
      state.enabled && state.colorScheme !== "system"
        ? [{ name: "prefers-color-scheme", value: state.colorScheme }]
        : [],
  });
}

function validScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
