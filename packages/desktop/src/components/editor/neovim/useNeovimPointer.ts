import { useCallback, useMemo } from "react";
import {
  MOUSE_PRESS,
  MOUSE_RELEASE,
  MOUSE_MOVE,
  MOUSE_SCROLL_UP,
  MOUSE_SCROLL_DOWN,
  type PointerLikeEvent,
} from "./useNeovimEngine";

interface UseNeovimPointerOptions {
  /** Returns the PTY bytes for an event, or `undefined` when Neovim wants none. */
  encodePointer: (event: PointerLikeEvent) => Uint8Array | undefined;
  write: (bytes: Uint8Array) => void;
  surfaceRef: React.RefObject<HTMLElement | null>;
}

export interface NeovimPointerHandlers {
  onMouseDown: (event: React.MouseEvent) => void;
  onMouseUp: (event: React.MouseEvent) => void;
  onMouseMove: (event: React.MouseEvent) => void;
  onWheel: (event: React.WheelEvent) => void;
}

/** DOM buttons are 0/1/2 (left/middle/right); the encoder wants 1/2/3. */
function toEncoderButton(domButton: number): number {
  return domButton + 1;
}

/**
 * Forwards pointer events to the Neovim PTY.
 *
 * Mouse reporting is opt-in per program: when `encodePointer` returns
 * `undefined`, the event is left to the browser (selection, focus) rather than
 * being swallowed by `preventDefault`.
 */
export function useNeovimPointer({
  encodePointer,
  write,
  surfaceRef,
}: UseNeovimPointerOptions): NeovimPointerHandlers {
  const send = useCallback(
    (kind: number, button: number, event: React.MouseEvent | React.WheelEvent) => {
      const bytes = encodePointer({
        kind,
        button,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      });
      if (bytes === undefined) return;
      event.preventDefault();
      write(bytes);
    },
    [encodePointer, write],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      // Focus regardless of reporting: keystrokes must reach the pane even when
      // Neovim ignores the click itself.
      surfaceRef.current?.focus();
      send(MOUSE_PRESS, toEncoderButton(event.button), event);
    },
    [send, surfaceRef],
  );

  const onMouseUp = useCallback(
    (event: React.MouseEvent) => send(MOUSE_RELEASE, toEncoderButton(event.button), event),
    [send],
  );

  const onMouseMove = useCallback(
    // `buttons` is a bitmask of held buttons; 0 means a bare hover, which only
    // motion-reporting programs care about. The encoder filters on the mode.
    (event: React.MouseEvent) => send(MOUSE_MOVE, event.buttons === 0 ? 0 : 1, event),
    [send],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent) =>
      send(event.deltaY < 0 ? MOUSE_SCROLL_UP : MOUSE_SCROLL_DOWN, 0, event),
    [send],
  );

  return useMemo(
    () => ({ onMouseDown, onMouseUp, onMouseMove, onWheel }),
    [onMouseDown, onMouseUp, onMouseMove, onWheel],
  );
}
