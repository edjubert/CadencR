/**
 * Neovim WS event subscription — filtered by `file_path`.
 *
 * Neovim's `cursor_moved`/`mode_changed`/`buffer_lines_changed` events
 * (Phase 1c's protocol, `packages/service/src/domain/ws_session/protocol/neovim.rs`)
 * arrive on the same per-feature WS connection as the `workflow`/`feature`
 * domains (see `ws-worktree-handler.ts`), dispatched from
 * `ws-envelope-handler.ts`'s `handleEnvelope`. Unlike those domains, the
 * consumer here is a specific CodeMirror instance for one open file, not a
 * Zustand store slice — so this module is a small pub/sub registry instead of
 * a store, letting `BaseCodeMirrorEditor.tsx` subscribe/unsubscribe as the
 * active file changes.
 */
import { isRecord } from "./ws-message-processing";

export interface NeovimEventHandlers {
  onCursorMoved: (line: number, col: number) => void;
  onModeChanged: (mode: string) => void;
  onBufferLinesChanged: (firstline: number, lastline: number, lines: string[]) => void;
}

interface NeovimListener {
  filePath: string;
  handlers: NeovimEventHandlers;
}

const listenersBySession = new Map<string, Set<NeovimListener>>();

/**
 * Subscribe to neovim WS events for one (sessionId, filePath) pair.
 * `sessionId` must be the WS session id (`ws-feature-<featureId>`, see
 * `lib/ws-session-id.ts`) — envelopes are dispatched keyed by that id
 * (`handleEnvelope`'s `sessionId` param), not the raw feature id.
 */
export function subscribeToNeovimEvents(
  sessionId: string,
  filePath: string,
  handlers: NeovimEventHandlers,
): () => void {
  const listener: NeovimListener = { filePath, handlers };
  const listeners = listenersBySession.get(sessionId) ?? new Set<NeovimListener>();
  listeners.add(listener);
  listenersBySession.set(sessionId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersBySession.delete(sessionId);
  };
}

/**
 * Called from `ws-envelope-handler.ts` for every `domain: "neovim"` envelope.
 * Dispatches only to listeners whose `filePath` matches the envelope's
 * `payload.file_path` — other open files/tabs stay unaffected.
 */
export function dispatchNeovimEnvelope(
  sessionId: string,
  envelope: { action: string; payload: unknown },
): void {
  const listeners = listenersBySession.get(sessionId);
  if (!listeners || listeners.size === 0) return;
  if (!isRecord(envelope.payload)) return;

  const filePath = envelope.payload.file_path;
  if (typeof filePath !== "string") return;

  for (const listener of listeners) {
    if (listener.filePath !== filePath) continue;
    applyToListener(listener, envelope.action, envelope.payload);
  }
}

function applyToListener(
  listener: NeovimListener,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case "cursor_moved":
      if (typeof payload.line === "number" && typeof payload.col === "number") {
        listener.handlers.onCursorMoved(payload.line, payload.col);
      }
      break;
    case "mode_changed":
      if (typeof payload.mode === "string") {
        listener.handlers.onModeChanged(payload.mode);
      }
      break;
    case "buffer_lines_changed":
      if (
        typeof payload.firstline === "number" &&
        typeof payload.lastline === "number" &&
        Array.isArray(payload.lines)
      ) {
        listener.handlers.onBufferLinesChanged(
          payload.firstline,
          payload.lastline,
          payload.lines as string[],
        );
      }
      break;
  }
}
