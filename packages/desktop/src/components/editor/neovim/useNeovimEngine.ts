import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTerminalEngine,
  Terminal,
  encodeKey,
  type TerminalConstructor,
} from "@/lib/neovim/terminal-engine";
import {
  GlyphAtlas,
  TerminalRenderer,
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
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;

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

  useEffect(() => {
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!surface || !canvas) return;

    const observer = new ResizeObserver(() => {
      const atlas = atlasRef.current;
      const terminal = terminalRef.current;
      if (!atlas || !terminal) return;

      const bounds = surface.getBoundingClientRect();
      const size = { cssWidth: bounds.width, cssHeight: bounds.height };
      const pixels = pixelSizeFor(size, window.devicePixelRatio);
      canvas.width = pixels.width;
      canvas.height = pixels.height;

      const next = gridSizeFor(size, atlas.cell, window.devicePixelRatio);
      const changed = computeGridResize(gridRef.current, next);
      if (changed) {
        terminal.resize(changed.columns, changed.lines);
        gridRef.current = changed;
        onResize(changed);
        dirtyRef.current = true;
      }
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [canvasRef, surfaceRef, onResize]);

  const feed = useCallback((bytes: Uint8Array) => {
    terminalRef.current?.feed(bytes);
    dirtyRef.current = true;
  }, []);

  const applicationCursor = useCallback(() => terminalRef.current?.applicationCursor ?? false, []);

  return { status, errorMessage, feed, applicationCursor };
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
