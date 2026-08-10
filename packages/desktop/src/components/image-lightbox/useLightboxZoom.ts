import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";

/**
 * Zoom and pan for the lightbox canvas.
 *
 * Scale 1 means "fit the viewport" (the image is laid out with `object-contain`
 * and CSS-transformed from there), so the zoom ladder is relative to the fit
 * size rather than to natural pixels.
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
const ZOOM_STEP = 1.5;
const WHEEL_SENSITIVITY = 0.0025;
/** A few pixels of travel is a click, not a drag. */
const DRAG_SLOP_PX = 3;

interface Offset {
  x: number;
  y: number;
}

const ORIGIN: Offset = { x: 0, y: 0 };

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

/**
 * Keep the magnified image overlapping its box, so a fast drag can't fling the
 * photo off-screen and leave the user staring at an empty overlay. The visible
 * overflow on each axis is half the growth from scaling, which is exactly how
 * far the image may travel before an edge crosses the centre line.
 */
function clampOffset(offset: Offset, scale: number, box: DOMRect | null): Offset {
  if (!box || scale <= MIN_ZOOM) return ORIGIN;
  const limitX = (box.width * (scale - 1)) / 2;
  const limitY = (box.height * (scale - 1)) / 2;
  return {
    x: Math.min(limitX, Math.max(-limitX, offset.x)),
    y: Math.min(limitY, Math.max(-limitY, offset.y)),
  };
}

export interface LightboxZoom {
  scale: number;
  offset: Offset;
  /** True once the image is magnified — drives the grab cursor and panning. */
  zoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /**
   * Click handler for the image: toggles between fit and a comfortable 2×
   * inspection zoom, but ignores the click that ends a pan drag.
   */
  onClick: () => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  panning: boolean;
}

/**
 * Wheel-to-zoom, on `window` in the capture phase.
 *
 * Two listeners have to be beaten to the event. React registers `wheel`
 * passively at its root, so an `onWheel` prop could never `preventDefault()` —
 * a trackpad pinch would zoom the image *and* the whole Electron page. And the
 * dialog's scroll lock (`react-remove-scroll`, via Radix) captures `wheel` on
 * `document` and cancels it, so a listener on the surface itself never fires at
 * all: the gesture looked handled — `defaultPrevented` was true — while the
 * image sat at 100%.
 *
 * Capture order runs window before document, so this sees the event first and
 * filters it to the surface by hit-testing the target.
 *
 * `zoomBy` must be referentially stable, or every zoom step would detach and
 * re-attach the listener.
 */
function useWheelZoom(
  surfaceRef: RefObject<HTMLElement | null>,
  zoomBy: (factor: number) => void,
): void {
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => {
      const surface = surfaceRef.current;
      if (!surface || !(event.target instanceof Node) || !surface.contains(event.target)) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [surfaceRef, zoomBy]);
}

interface DragOrigin {
  x: number;
  y: number;
  offset: Offset;
}

/** Drag-to-pan, active only once the image is magnified past its fit size. */
function usePan(args: {
  surfaceRef: RefObject<HTMLElement | null>;
  scale: number;
  offset: Offset;
  setOffset: (offset: Offset) => void;
  setPanning: (panning: boolean) => void;
  dragStart: MutableRefObject<DragOrigin | null>;
  draggedRef: MutableRefObject<boolean>;
}) {
  const { surfaceRef, scale, offset, setOffset, setPanning, dragStart, draggedRef } = args;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (scale <= MIN_ZOOM || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStart.current = { x: event.clientX, y: event.clientY, offset };
      setPanning(true);
    },
    [dragStart, offset, scale, setPanning],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const start = dragStart.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX) draggedRef.current = true;
      setOffset(
        clampOffset(
          { x: start.offset.x + dx, y: start.offset.y + dy },
          scale,
          surfaceRef.current?.getBoundingClientRect() ?? null,
        ),
      );
    },
    [dragStart, draggedRef, scale, setOffset, surfaceRef],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!dragStart.current) return;
      dragStart.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [dragStart, setPanning],
  );

  return useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp }),
    [onPointerDown, onPointerMove, onPointerUp],
  );
}

/**
 * @param surfaceRef the element the wheel gesture belongs to — also the box the
 * pan is clamped against.
 */
export function useLightboxZoom(
  resetKey: string | number,
  surfaceRef: RefObject<HTMLElement | null>,
): LightboxZoom {
  const [scale, setScale] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>(ORIGIN);
  const [panning, setPanning] = useState(false);
  const dragStart = useRef<DragOrigin | null>(null);
  const draggedRef = useRef(false);
  // Mirrors of the live values, so the stable callbacks below (and the native
  // wheel listener) can read the current view without being rebuilt for it.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // Switching images (or reopening) always starts from fit.
  useEffect(() => {
    setScale(MIN_ZOOM);
    setOffset(ORIGIN);
    setPanning(false);
    dragStart.current = null;
  }, [resetKey]);

  /**
   * Scale and offset move together, and both are set from plain values read off
   * refs rather than from `setState` updaters — updaters must be pure, so the
   * offset update cannot be nested inside the scale one, and StrictMode
   * double-invokes them.
   */
  const applyScale = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      setScale(clamped);
      // Back at fit there is nothing to pan, so `clampOffset` recentres rather
      // than leaving the image parked off to one side.
      setOffset(
        clampOffset(
          offsetRef.current,
          clamped,
          surfaceRef.current?.getBoundingClientRect() ?? null,
        ),
      );
    },
    [surfaceRef],
  );
  const zoomBy = useCallback(
    (factor: number) => applyScale(scaleRef.current * factor),
    [applyScale],
  );

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const reset = useCallback(() => applyScale(MIN_ZOOM), [applyScale]);
  // A pan ends with a click on the image. Without the guard the drag that just
  // positioned the photo would immediately snap it back to fit.
  const onClick = useCallback(() => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    applyScale(scaleRef.current > MIN_ZOOM ? MIN_ZOOM : 2);
  }, [applyScale]);

  useWheelZoom(surfaceRef, zoomBy);

  const { onPointerDown, onPointerMove, onPointerUp } = usePan({
    surfaceRef,
    scale,
    offset,
    setOffset,
    setPanning,
    dragStart,
    draggedRef,
  });

  return useMemo(
    () => ({
      scale,
      offset,
      zoomed: scale > MIN_ZOOM,
      zoomIn,
      zoomOut,
      reset,
      onClick,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      panning,
    }),
    [
      offset,
      onClick,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      panning,
      reset,
      scale,
      zoomIn,
      zoomOut,
    ],
  );
}
