import { createEnvelope } from "@/lib/ws-envelope";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

/**
 * Forwards a captured keydown to the headless Neovim process for this
 * feature, over the same per-feature WS connection used by the `session`/
 * `workflow`/`neovim` domains (Phase 1c protocol).
 *
 * A dropped keystroke while the socket is reconnecting isn't independently
 * surfaced here — the global connection-status banner (`connection-status-store`,
 * wired in `ws-session-connect.ts`) already tells the user the connection is
 * down; toasting per-keystroke on top of that would be pure noise on a hot
 * path. The console warning is a debugging aid, not the primary error surface.
 */
export function sendNeovimKeyInput(featureId: string, filePath: string, keys: string): void {
  const sessionId = wsSessionIdFromFeature(Number(featureId));
  const session = useWsSessionStore.getState().sessions[sessionId];
  const envelope = createEnvelope("neovim", "key_input", {
    feature_id: Number(featureId),
    file_path: filePath,
    keys,
  });
  const sent = session?.conn?.sendJson(envelope) ?? false;
  if (!sent) {
    console.warn("[neovim] dropped key_input — no active WS connection", { featureId, filePath });
  }
}
