import { execFile } from "node:child_process";
import type { Display, Rectangle } from "electron";
import { z } from "zod";

/**
 * Where the notch island lives: which display, and the cutout it hugs.
 *
 * Electron exposes no notch API, but AppKit does (`NSScreen.safeAreaInsets` +
 * `auxiliaryTopLeftArea`/`auxiliaryTopRightArea`, macOS 12+). Rather than ship
 * a native module, one JXA call through `osascript` reads them — exact to the
 * point on every notched model and scaled resolution. If that probe fails we
 * fall back to a menu-bar-height heuristic; with no notched display connected
 * (clamshell mode, external monitor) the island becomes a virtual notch at the
 * top center of the primary display.
 */

export interface ProbedNotch {
  /** Cocoa frame of the screen (bottom-left origin, points). */
  x: number;
  y: number;
  width: number;
  height: number;
  notchWidth: number;
  notchHeight: number;
}

export interface NotchPlacement {
  display: Display;
  notchWidth: number;
  notchHeight: number;
  hardware: boolean;
}

const VIRTUAL_NOTCH_WIDTH = 184;
/** Typical cutout width on 14"/16" panels, used only when the probe fails. */
const HEURISTIC_NOTCH_WIDTH = 200;
/** Notched panels run a ~37-38pt menu bar; classic ones 24-25pt. */
const NOTCHED_MENU_BAR_MIN = 31;

const JXA_PROBE = `
ObjC.import("AppKit");
JSON.stringify(ObjC.unwrap($.NSScreen.screens).map(function (s) {
  var f = s.frame, l = s.auxiliaryTopLeftArea, r = s.auxiliaryTopRightArea, inset = s.safeAreaInsets;
  return {
    x: f.origin.x, y: f.origin.y, width: f.size.width, height: f.size.height,
    top: inset.top,
    leftEnd: l.origin.x + l.size.width,
    rightStart: r.origin.x,
  };
}));
`;

const probeRowSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  top: z.number(),
  leftEnd: z.number(),
  rightStart: z.number(),
});

export function parseNotchProbe(stdout: string): ProbedNotch[] {
  const rows = z.array(probeRowSchema).parse(JSON.parse(stdout));
  return rows
    .filter((row) => row.top > 0 && row.rightStart > row.leftEnd)
    .map((row) => ({
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      notchWidth: Math.round(row.rightStart - row.leftEnd),
      notchHeight: Math.round(row.top),
    }));
}

/** Resolves `null` when the probe can't run; the caller then falls back to heuristics. */
export function probeHardwareNotches(): Promise<ProbedNotch[] | null> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", JXA_PROBE],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error) {
          console.warn(`[notch] display probe failed, using heuristics: ${error.message}`);
          resolve(null);
          return;
        }
        try {
          resolve(parseNotchProbe(stdout));
        } catch (parseError) {
          console.warn(`[notch] display probe returned unexpected output: ${String(parseError)}`);
          resolve(null);
        }
      },
    );
  });
}

function menuBarHeight(display: Display): number {
  return Math.max(0, display.workArea.y - display.bounds.y);
}

/** Cocoa frames grow upward from the primary display's bottom edge. */
function matchesCocoaFrame(bounds: Rectangle, primary: Rectangle, probed: ProbedNotch): boolean {
  const cocoaY = primary.height - (bounds.y + bounds.height);
  return (
    Math.round(probed.width) === bounds.width &&
    Math.round(probed.height) === bounds.height &&
    Math.round(probed.x) === bounds.x &&
    Math.round(probed.y) === cocoaY
  );
}

export function resolveNotchPlacement(
  displays: readonly Display[],
  primary: Display,
  probed: readonly ProbedNotch[] | null,
): NotchPlacement {
  for (const display of displays) {
    const match = probed?.find((p) => matchesCocoaFrame(display.bounds, primary.bounds, p));
    if (match) {
      return {
        display,
        notchWidth: match.notchWidth,
        notchHeight: match.notchHeight,
        hardware: true,
      };
    }
  }
  if (probed === null) {
    const notched = displays.find(
      (display) => display.internal && menuBarHeight(display) >= NOTCHED_MENU_BAR_MIN,
    );
    if (notched) {
      return {
        display: notched,
        notchWidth: HEURISTIC_NOTCH_WIDTH,
        notchHeight: menuBarHeight(notched),
        hardware: true,
      };
    }
  }
  return {
    display: primary,
    notchWidth: VIRTUAL_NOTCH_WIDTH,
    notchHeight: Math.max(24, menuBarHeight(primary)),
    hardware: false,
  };
}
