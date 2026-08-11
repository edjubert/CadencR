import { useCallback, useMemo } from "react";
import type { TerminalTransport } from "./cathode-term-stubs";

interface TerminalSocketHandle {
  connect: (cols: number, rows: number) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  isConnected: boolean;
}

/**
 * Presents the shell terminal's WebSocket hook as a `TerminalTransport`.
 *
 * The hook does considerably more than four methods: it reattaches to a PTY
 * by id, reports exit codes, replays scrollback after a reconnect and
 * recovers from a stalled socket. None of that is the component's business,
 * and this file is where it stops.
 *
 * Encoding note: the socket carries `data` as a string. The transport
 * interface expects bytes. We convert at this boundary with
 * `TextEncoder`/`TextDecoder`. This is lossy for non-UTF-8 output —
 * the same corruption described in PROTOCOL.md. Pre-existing in CadencR,
 * not introduced here. Followup: change the endpoint to accept bytes.
 */
export function useCathodeTransport(
  socket: TerminalSocketHandle,
): TerminalTransport {
  const transport = useMemo((): TerminalTransport => {
    const subscribers: Array<(data: string) => void> = [];
    const closeCallbacks: Array<() => void> = [];

    return {
      write(data: Uint8Array) {
        const text = new TextDecoder().decode(data);
        socket.write(text);
      },
      resize(cols: number, rows: number) {
        socket.resize(cols, rows);
      },
      connect(cols: number, rows: number) {
        socket.connect(cols, rows);
      },
      kill() {
        socket.kill();
      },
      onData(callback: (data: string) => void) {
        subscribers.push(callback);
        return () => {
          const idx = subscribers.indexOf(callback);
          if (idx !== -1) subscribers.splice(idx, 1);
        };
      },
      onClose(callback: () => void) {
        closeCallbacks.push(callback);
        return () => {
          const idx = closeCallbacks.indexOf(callback);
          if (idx !== -1) closeCallbacks.splice(idx, 1);
        };
      },
    };
  }, [socket]);

  return transport;
}
