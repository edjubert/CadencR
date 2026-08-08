import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTerminalEngine,
  Terminal,
  encodeKey,
  encodeMouse,
  type TerminalConstructor,
} from "@/lib/neovim/terminal-engine";
import {
  GlyphAtlas,
  TerminalRenderer,
  cellAtPixel,
  gridSizeFor,
  pixelSizeFor,
  type FontSpec,
} from "@cadencr/terminal-core";
import { buildPaletteOverrides } from "./neovim-palette";
import type { XTermPalette } from "@/lib/themes/types";

// Matches Cadencr's existing shell terminal font
// (`components/terminal/createXtermInstance.ts`) — no dedicated Neovim font
// setting exists yet.
const NEOVIM_FONT: FontSpec = {
  family:
    "'FiraCode Nerd Font', 'Fira Code', 'CaskaydiaCove Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  size: 13,
  weight: "400",
  lineHeight: 1.2,
};

export interface GridSize {
  columns: number;
  lines: number;
}

/** `MouseReporting::None` — the program wants no mouse events at all. */
const MOUSE_REPORTING_NONE = 0;

/** Mouse event kinds, matching `encode_mouse_js`'s discriminants. */
export const MOUSE_PRESS = 0;
export const MOUSE_RELEASE = 1;
export const MOUSE_MOVE = 2;
export const MOUSE_SCROLL_UP = 3;
export const MOUSE_SCROLL_DOWN = 4;

/** The slice of a DOM pointer/wheel event the encoder needs. */
export interface PointerLikeEvent {
  kind: number;
  /** 0 none, 1 left, 2 middle, 3 right — `encode_mouse_js`'s discriminants. */
  button: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** `null` when the cell count is unchanged — callers use this to skip a redundant resize. */
export function computeGridResize(previous: GridSize, next: GridSize): GridSize | null {
  if (previous.columns === next.columns && previous.lines === next.lines) return null;
  return next;
}

interface UseNeovimEngineOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  surfaceRef: React.RefObject<HTMLElement | null>;
  palette: XTermPalette;
  onResize: (grid: GridSize) => void;
}

interface UseNeovimEngineReturn {
  status: "loading" | "ready" | "error";
  errorMessage: string | null;
  feed: (bytes: Uint8Array) => void;
  applicationCursor: () => boolean;
  currentGrid: () => GridSize;
  encodePointer: (event: PointerLikeEvent) => Uint8Array | undefined;
}

/**
 * Owns the wasm engine, the glyph atlas and the WebGPU renderer for one pane.
 * Redraws only when marked dirty by a `feed()` call or a resize — never an
 * identical frame, per the frontend-performance rule for hot paths.
 */
export function useNeovimEngine({
  canvasRef,
  surfaceRef,
  palette,
  onResize,
}: UseNeovimEngineOptions): UseNeovimEngineReturn {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const terminalRef = useRef<InstanceType<TerminalConstructor> | null>(null);
  const rendererRef = useRef<TerminalRenderer | null>(null);
  const atlasRef = useRef<GlyphAtlas | null>(null);
  const dirtyRef = useRef(true);
  const gridRef = useRef<GridSize>({ columns: 1, lines: 1 });

  useEffect(() => {
    let cancelled = false;
    let frame = 0;

    async function setup(): Promise<void> {
      try {
        await loadTerminalEngine();
        if (cancelled) return;
        const canvas = canvasRef.current;
        // Surfaced rather than returned silently: a missing canvas here means
        // the pane gated it behind `status === "ready"`, which deadlocks the
        // engine (no canvas → no engine → never ready).
        if (!canvas) throw new Error("Neovim canvas is not mounted");

        const atlas = new GlyphAtlas(NEOVIM_FONT, window.devicePixelRatio);
        const renderer = await TerminalRenderer.create(canvas, atlas);
        if (cancelled) return;

        renderer.setPalette(buildPaletteOverrides(palette));
        atlasRef.current = atlas;
        rendererRef.current = renderer;
        terminalRef.current = new Terminal(80, 24);
        gridRef.current = { columns: 80, lines: 24 };
        dirtyRef.current = true;
        setStatus("ready");

        const draw = (): void => {
          const terminal = terminalRef.current;
          const currentRenderer = rendererRef.current;
          if (terminal && currentRenderer && dirtyRef.current) {
            terminal.refreshSnapshot();
            const memory = terminalEngineMemory();
            const packed = new Uint32Array(memory, terminal.snapshotPtr(), terminal.snapshotLen());
            currentRenderer.render({
              columns: terminal.columns,
              lines: terminal.screenLines,
              packed,
            });
            dirtyRef.current = false;
          }
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      } catch (error: unknown) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    }

    void setup();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setPalette(buildPaletteOverrides(palette));
    dirtyRef.current = true;
  }, [palette]);

  // Re-runs when the engine becomes ready: the first observer is installed while
  // `atlas`/`terminal` are still null, so its initial callback bails out and the
  // grid would stay at the PTY's spawn size. Re-observing once ready re-fires
  // the callback with the real measurements.
  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!surface || !canvas) return;

    const observer = new ResizeObserver(() => {
      const changed = remeasure(surface, canvas, atlasRef.current, terminalRef.current, gridRef);
      if (!changed) return;
      onResize(changed);
      dirtyRef.current = true;
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [canvasRef, surfaceRef, onResize, status]);

  const feed = useCallback((bytes: Uint8Array) => {
    terminalRef.current?.feed(bytes);
    dirtyRef.current = true;
  }, []);

  const applicationCursor = useCallback(() => terminalRef.current?.applicationCursor ?? false, []);

  /** Current grid, so the pane can re-send it once the socket is actually open. */
  const currentGrid = useCallback(() => gridRef.current, []);

  const encodePointer = useCallback(
    (event: PointerLikeEvent): Uint8Array | undefined =>
      encodePointerBytes(terminalRef.current, atlasRef.current, surfaceRef.current, event),
    [surfaceRef],
  );

  return { status, errorMessage, feed, applicationCursor, currentGrid, encodePointer };
}

/**
 * Resize the canvas to the surface and, when the cell count actually changed,
 * resize the terminal too. Returns the new grid, or `null` when nothing moved.
 */
function remeasure(
  surface: HTMLElement,
  canvas: HTMLCanvasElement,
  atlas: GlyphAtlas | null,
  terminal: InstanceType<TerminalConstructor> | null,
  gridRef: React.RefObject<GridSize>,
): GridSize | null {
  if (!atlas || !terminal) return null;

  const bounds = surface.getBoundingClientRect();
  // Inactive tabs stay mounted under `display: none` (see
  // `feature-layout/TabContentRegistry`), which reports a 0x0 box. Measuring it
  // would clamp the grid to 1x1 and make Neovim tear down its splits
  // ("E36: Not enough room") every time the user looks at another tab.
  if (bounds.width === 0 || bounds.height === 0) return null;

  const size = { cssWidth: bounds.width, cssHeight: bounds.height };
  const pixels = pixelSizeFor(size, window.devicePixelRatio);
  canvas.width = pixels.width;
  canvas.height = pixels.height;

  const next = gridSizeFor(size, atlas.cell, window.devicePixelRatio);
  const changed = computeGridResize(gridRef.current, next);
  if (!changed) return null;

  terminal.resize(changed.columns, changed.lines);
  gridRef.current = changed;
  return changed;
}

/**
 * PTY bytes for a pointer event, or `undefined` when the running program asked
 * for no mouse reporting — in which case the caller must let the browser handle
 * the event normally rather than swallowing it.
 */
function encodePointerBytes(
  terminal: InstanceType<TerminalConstructor> | null,
  atlas: GlyphAtlas | null,
  surface: HTMLElement | null,
  event: PointerLikeEvent,
): Uint8Array | undefined {
  if (!terminal || !atlas || !surface) return undefined;
  // Checked before measuring: `mousemove` fires continuously, and a layout read
  // on every one of them is exactly what the frontend-performance rule forbids
  // on a hot path. Most of the time Neovim wants no reporting at all.
  const reporting = terminal.mouseReporting;
  if (reporting === MOUSE_REPORTING_NONE) return undefined;

  const bounds = surface.getBoundingClientRect();
  const { column, line } = cellAtPixel(
    { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    atlas.cell,
    window.devicePixelRatio,
  );
  return encodeMouse(
    event.kind,
    event.button,
    line,
    column,
    event.ctrlKey,
    event.altKey,
    event.shiftKey,
    terminal.sgrMouse,
    reporting,
    terminal.alternateScroll,
    terminal.altScreen,
  );
}

/** The wasm module's linear memory. Re-read on every use — never cached — since
 * any Rust allocation can grow it and detach previously created views. */
function terminalEngineMemory(): ArrayBuffer {
  const accessor = (
    globalThis as unknown as { __cadencrTerminalCoreMemory?: () => WebAssembly.Memory }
  ).__cadencrTerminalCoreMemory;
  if (accessor === undefined) {
    throw new Error("terminal-core wasm memory accessor is unavailable");
  }
  return accessor().buffer;
}

export { encodeKey };
