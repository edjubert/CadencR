import path from "node:path";
import { app, BrowserWindow, screen } from "electron";
import {
  DEFAULT_NOTCH_PREFS,
  type NotchCapabilities,
  type NotchConfig,
  type NotchFeatureRef,
  type NotchGeometry,
  type NotchHotRect,
  type NotchNotification,
  type NotchPrefs,
  type NotchReadyPayload,
  type NotchSnapshot,
} from "../../src/shared/notch";
import {
  probeHardwareNotches,
  resolveNotchPlacement,
  type NotchPlacement,
  type ProbedNotch,
} from "./notch-geometry";
import { sendNotificationClick } from "./notifications";
import { rendererLoadTarget, secureWebContents } from "./renderer-window-security";
import { sendToWindow } from "./safe-send";

/**
 * The notch island: a transparent, click-through panel hugging the display's
 * notch, above the menu bar, on every Space and over full-screen apps.
 *
 * It owns no agent state. The app renderer composes snapshots and pushes them
 * here; this controller relays them to the island and routes a click back to
 * the main window through the regular notification-click path.
 *
 * Hover is detected by sampling the cursor rather than by forwarded mouse
 * events: the island must react while Cadencr is in the background, and
 * forwarding is only reliable for the focused app. The window ignores the
 * mouse until the cursor enters the island's reported hot rect, so the menu
 * bar and the apps beneath stay fully usable.
 */

const WINDOW_WIDTH = 720;
const WINDOW_HEIGHT = 620;
const POINTER_POLL_MS = 50;
/** Away from the island the pointer can't reach it within one tick, so sample lazily. */
const POINTER_IDLE_POLL_MS = 200;
const POINTER_NEAR_PX = 160;
const MAX_PENDING_NOTIFICATIONS = 4;

export interface NotchControllerOptions {
  getMainWindow: () => BrowserWindow | null;
}

export class NotchController {
  private win: BrowserWindow | null = null;
  private enabled = false;
  private ready = false;
  private snapshot: NotchSnapshot = { agents: [] };
  private pendingNotifications: NotchNotification[] = [];
  private placement: NotchPlacement | null = null;
  private probed: ProbedNotch[] | null | undefined;
  private bounds: Electron.Rectangle | null = null;
  private hotRect: NotchHotRect | null = null;
  private hovering = false;
  /** After a click-through collapse, wait for the pointer to leave before re-expanding. */
  private suppressUntilLeave = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private placing: Promise<void> | null = null;
  private prefs: NotchPrefs = DEFAULT_NOTCH_PREFS;
  private readonly onDisplaysChanged = (): void => {
    this.probed = undefined;
    void this.place();
  };
  /** The work area follows the Dock and a full-screen menu bar; only size or scale moves the notch. */
  private readonly onDisplayMetricsChanged = (
    _event: Electron.Event,
    _display: Electron.Display,
    changed: string[],
  ): void => {
    if (changed.includes("bounds") || changed.includes("scaleFactor")) this.onDisplaysChanged();
  };

  constructor(private readonly options: NotchControllerOptions) {}

  get window(): BrowserWindow | null {
    return this.win;
  }

  async capabilities(): Promise<NotchCapabilities> {
    if (process.platform !== "darwin") return { supported: false, hardware: false };
    const placement = await this.resolvePlacement();
    return { supported: true, hardware: placement.hardware };
  }

  /** Apply the user's notch settings, turning the island on or off with them. */
  async configure({ enabled, prefs }: NotchConfig): Promise<void> {
    if (process.platform !== "darwin") return;
    this.prefs = prefs;
    if (this.ready) sendToWindow(this.win, "notch:prefs", prefs);
    await this.setEnabled(enabled);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (process.platform !== "darwin") return;
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      // Displays may have changed while the listeners were off.
      this.probed = undefined;
      screen.on("display-added", this.onDisplaysChanged);
      screen.on("display-removed", this.onDisplaysChanged);
      screen.on("display-metrics-changed", this.onDisplayMetricsChanged);
      await this.place();
      return;
    }
    screen.off("display-added", this.onDisplaysChanged);
    screen.off("display-removed", this.onDisplaysChanged);
    screen.off("display-metrics-changed", this.onDisplayMetricsChanged);
    this.destroyWindow();
  }

  pushSnapshot(snapshot: NotchSnapshot): void {
    this.snapshot = snapshot;
    if (this.ready) sendToWindow(this.win, "notch:snapshot", snapshot);
  }

  pushNotification(notification: NotchNotification): void {
    if (!this.enabled) return;
    if (this.ready) {
      sendToWindow(this.win, "notch:notification", notification);
      return;
    }
    this.pendingNotifications = [...this.pendingNotifications, notification].slice(
      -MAX_PENDING_NOTIFICATIONS,
    );
  }

  /** The island's renderer finished loading: hand it everything it missed. */
  markReady(): NotchReadyPayload {
    this.ready = true;
    // The island subscribes before it calls `ready()`.
    for (const notification of this.pendingNotifications) {
      sendToWindow(this.win, "notch:notification", notification);
    }
    this.pendingNotifications = [];
    return { geometry: this.geometry(), snapshot: this.snapshot, prefs: this.prefs };
  }

  setHotRect(rect: NotchHotRect): void {
    this.hotRect = rect;
  }

  openFeature(ref: NotchFeatureRef): void {
    const main = this.options.getMainWindow();
    if (!main || main.isDestroyed()) throw new Error("The Cadencr window is not open.");
    if (main.isMinimized()) main.restore();
    main.show();
    app.focus({ steal: true });
    main.focus();
    sendNotificationClick(main, ref);
    this.collapse();
  }

  /** Forward a "clear this finished agent" gesture to the app renderer that owns the list. */
  dismissFeature(ref: NotchFeatureRef): void {
    sendToWindow(this.options.getMainWindow(), "notch:dismissed", ref);
  }

  private geometry(): NotchGeometry | null {
    const bounds = this.bounds;
    if (!this.placement || !bounds) return null;
    return {
      notchWidth: this.placement.notchWidth,
      notchHeight: this.placement.notchHeight,
      hardware: this.placement.hardware,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
    };
  }

  private async resolvePlacement(): Promise<NotchPlacement> {
    if (this.probed === undefined) this.probed = await probeHardwareNotches();
    return resolveNotchPlacement(screen.getAllDisplays(), screen.getPrimaryDisplay(), this.probed);
  }

  /** Serialized: display events arrive in bursts while a probe is in flight. */
  private place(): Promise<void> {
    const run = async (): Promise<void> => {
      const placement = await this.resolvePlacement();
      if (!this.enabled) return;
      this.placement = placement;
      const { bounds } = placement.display;
      const width = Math.min(WINDOW_WIDTH, bounds.width);
      const next = {
        x: Math.round(bounds.x + (bounds.width - width) / 2),
        y: bounds.y,
        width,
        height: Math.min(WINDOW_HEIGHT, bounds.height),
      };
      const win = this.win ?? this.createWindow(next);
      win.setBounds(next);
      this.bounds = next;
      if (this.ready) sendToWindow(win, "notch:geometry", this.geometry());
    };
    const chained = (this.placing ?? Promise.resolve()).then(run, run);
    this.placing = chained.finally(() => {
      if (this.placing === chained) this.placing = null;
    });
    return chained;
  }

  private createWindow(bounds: Electron.Rectangle): BrowserWindow {
    const win = new BrowserWindow({
      ...bounds,
      type: "panel",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/notch.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    // Above the menu bar (24) yet below its drop-down menus (101).
    win.setAlwaysOnTop(true, "status");
    win.setIgnoreMouseEvents(true, { forward: true });
    secureWebContents(win.webContents);
    win.once("ready-to-show", () => win.showInactive());
    win.on("closed", () => {
      if (this.win === win) this.resetWindowState();
    });
    void loadNotchPage(win);
    this.win = win;
    this.startPolling();
    return win;
  }

  private destroyWindow(): void {
    const win = this.win;
    this.resetWindowState();
    if (win && !win.isDestroyed()) win.destroy();
  }

  private resetWindowState(): void {
    this.stopPolling();
    this.win = null;
    this.bounds = null;
    this.ready = false;
    this.hovering = false;
    this.suppressUntilLeave = false;
    this.hotRect = null;
  }

  private startPolling(): void {
    this.stopPolling();
    const tick = (): void => {
      this.pollTimer = setTimeout(tick, this.samplePointer());
    };
    tick();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** Returns how long to wait before the next sample. */
  private samplePointer(): number {
    const { win, bounds, hotRect: rect } = this;
    if (!win || win.isDestroyed() || !this.ready || !rect || !bounds) return POINTER_IDLE_POLL_MS;
    const point = screen.getCursorScreenPoint();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    const inside =
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
    const near =
      this.hovering ||
      (x >= rect.x - POINTER_NEAR_PX &&
        x <= rect.x + rect.width + POINTER_NEAR_PX &&
        y <= rect.y + rect.height + POINTER_NEAR_PX);
    const next = near ? POINTER_POLL_MS : POINTER_IDLE_POLL_MS;
    if (this.suppressUntilLeave) {
      if (!inside) this.suppressUntilLeave = false;
      return next;
    }
    if (inside === this.hovering) return next;
    this.hovering = inside;
    win.setIgnoreMouseEvents(!inside, { forward: true });
    sendToWindow(win, "notch:hover", inside);
    return POINTER_POLL_MS;
  }

  private collapse(): void {
    if (!this.win || !this.hovering) return;
    this.hovering = false;
    this.suppressUntilLeave = true;
    this.win.setIgnoreMouseEvents(true, { forward: true });
    sendToWindow(this.win, "notch:hover", false);
  }
}

/**
 * Chromium keeps one zoom level per origin, so the app's zoom would scale the
 * island off the notch. Packaged `file://` pages are keyed by their full path
 * and already isolated; the dev server is reached through its other loopback
 * name for the same effect.
 */
export function notchPageUrl(rendererUrl: string): string {
  const url = new URL("notch.html", rendererUrl);
  if (url.hostname === "127.0.0.1") url.hostname = "localhost";
  else if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}

function loadNotchPage(win: BrowserWindow): Promise<void> {
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1));
  const target = rendererLoadTarget();
  if (target.kind === "url") return win.loadURL(notchPageUrl(target.value));
  return win.loadFile(path.join(path.dirname(target.value), "notch.html"));
}
