/**
 * Wire contract of the macOS notch island, shared by the three processes it
 * spans: the app renderer (the single source of agent state, which composes
 * snapshots), the Electron main process (which validates and relays them) and
 * the notch renderer (which only draws what it is handed).
 *
 * Every payload crossing IPC is parsed with these schemas on the receiving
 * side of the main process — the notch window never trusts the app renderer
 * blindly, and vice versa.
 */
import { z } from "zod";

const title = z.string().min(1).max(200);
const text = z.string().max(600);
const id = z.number().int().positive();
const epochMs = z.number().int().nonnegative();
/** Provider icons are bundled assets: a same-origin path or an inline data URL. */
export function isBundledIconSrc(src: string): boolean {
  return src.startsWith("/") || src.startsWith("./") || src.startsWith("data:image/");
}
const iconSrc = z.string().max(200_000).refine(isBundledIconSrc, {
  message: "Provider icon must be a bundled asset.",
});

export const NOTCH_ACTION_KINDS = [
  "bash",
  "edit",
  "read",
  "search",
  "web",
  "agent",
  "mcp",
  "tool",
] as const;
export type NotchActionKind = (typeof NOTCH_ACTION_KINDS)[number];

export const notchAgentSchema = z.object({
  featureId: id,
  projectId: id,
  title,
  projectName: z.string().max(200),
  status: z.enum(["running", "question", "done"]),
  /** Only set while `status === "question"`. */
  pendingKind: z.enum(["permission", "question"]).nullable(),
  providerLabel: z.string().max(80).nullable(),
  providerIconSrc: iconSrc.nullable(),
  providerIconMono: z.boolean(),
  /** Server-stamped start of the running turn — anchors the live timer. */
  turnStartedAtMs: epochMs.nullable(),
  /** Latest activity; for a finished agent, when it finished. */
  lastActivityAtMs: epochMs.nullable(),
  lastAction: z.object({ kind: z.enum(NOTCH_ACTION_KINDS), label: text }).nullable(),
  /** Start of the agent's latest reply. */
  preview: text.nullable(),
  unread: z.boolean(),
});
export type NotchAgent = z.infer<typeof notchAgentSchema>;
export type NotchAgentStatus = NotchAgent["status"];

export const NOTCH_MAX_AGENTS = 24;

export const notchSnapshotSchema = z.object({
  agents: z.array(notchAgentSchema).max(NOTCH_MAX_AGENTS),
});
export type NotchSnapshot = z.infer<typeof notchSnapshotSchema>;

export const notchNotificationSchema = z.object({
  id: z.string().min(1).max(80),
  /** `null` for the Settings preview, which has no conversation to open. */
  featureId: id.nullable(),
  projectId: id.nullable(),
  status: z.enum(["completed", "needs_input", "error"]),
  title,
  body: text,
});
/** The island enriches a notification (provider, project) from its latest snapshot. */
export type NotchNotification = z.infer<typeof notchNotificationSchema>;

export const notchFeatureRefSchema = z.object({ featureId: id, projectId: id });
export type NotchFeatureRef = z.infer<typeof notchFeatureRefSchema>;

/** Window-relative rectangle (CSS px == DIP) the pointer must stay inside. */
export const notchHotRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export type NotchHotRect = z.infer<typeof notchHotRectSchema>;

/** The user's notch settings, pushed by the app renderer that reads them. */
export const notchPrefsSchema = z.object({
  /** Keep the compact island (ears) out while agents are tracked; off → hover and peeks only. */
  alwaysOn: z.boolean(),
  /** Keep the logo moving in the compact island; off → it only animates while open. */
  alwaysAnimate: z.boolean(),
});
export type NotchPrefs = z.infer<typeof notchPrefsSchema>;

export const DEFAULT_NOTCH_PREFS: NotchPrefs = {
  alwaysOn: true,
  alwaysAnimate: false,
};

/** Everything the app renderer decides about the island in one message. */
export const notchConfigSchema = z.object({ enabled: z.boolean(), prefs: notchPrefsSchema });
export type NotchConfig = z.infer<typeof notchConfigSchema>;

export interface NotchGeometry {
  /** Width of the cutout (or of the virtual notch drawn on a notchless screen). */
  notchWidth: number;
  /** Height of the cutout — equal to the menu bar on notched displays. */
  notchHeight: number;
  /** False when no notched display is connected and the island is virtual. */
  hardware: boolean;
  windowWidth: number;
  windowHeight: number;
}

/** What the island receives once its renderer is up. */
export interface NotchReadyPayload {
  geometry: NotchGeometry | null;
  snapshot: NotchSnapshot;
  prefs: NotchPrefs;
}

/** The island renderer's bridge, exposed by `electron/preload/notch.ts`. */
export interface NotchBridge {
  ready: () => Promise<NotchReadyPayload>;
  setHotRect: (rect: NotchHotRect) => Promise<void>;
  openFeature: (ref: NotchFeatureRef) => Promise<void>;
  dismiss: (ref: NotchFeatureRef) => Promise<void>;
  onSnapshot: (cb: (snapshot: NotchSnapshot) => void) => () => void;
  onNotification: (cb: (notification: NotchNotification) => void) => () => void;
  onHover: (cb: (hovering: boolean) => void) => () => void;
  onGeometry: (cb: (geometry: NotchGeometry | null) => void) => () => void;
  onPrefs: (cb: (prefs: NotchPrefs) => void) => () => void;
}

export interface NotchCapabilities {
  /** The island exists only in the macOS desktop shell. */
  supported: boolean;
  /** A display with a hardware notch is connected right now. */
  hardware: boolean;
}
