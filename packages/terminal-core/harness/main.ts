/**
 * Standalone harness: wires the wasm engine, the glyph atlas and the WebGPU
 * renderer into an interactive terminal.
 *
 * Input loops back on itself — a key is encoded to bytes and those bytes are
 * fed straight back into the engine. There is no PTY here; connecting to the
 * real Neovim stream is a later plan. The loopback is enough to exercise the
 * whole path: keyboard → bytes → parser → grid → GPU.
 */

import init, { type InitOutput, Terminal, encodeKey } from "../pkg/terminal_core.js";
import {
  cellAtPixel,
  GlyphAtlas,
  gridSizeFor,
  pixelSizeFor,
  TerminalRenderer,
  type FontSpec,
} from "../renderer/index";

const THEMES: Record<string, Map<number, string>> = {
  dark: new Map([
    [256, "#dddddd"],
    [257, "#1a1a1a"],
    [1, "#e06c75"],
    [2, "#98c379"],
    [4, "#61afef"],
  ]),
  light: new Map([
    [256, "#222222"],
    [257, "#fafafa"],
    [1, "#c0392b"],
    [2, "#27ae60"],
    [4, "#2980b9"],
  ]),
  solarized: new Map([
    [256, "#839496"],
    [257, "#002b36"],
    [1, "#dc322f"],
    [2, "#859900"],
    [4, "#268bd2"],
  ]),
};

const surface = requireElement<HTMLDivElement>("surface");
const canvas = requireElement<HTMLCanvasElement>("canvas");
const statusEl = requireElement<HTMLDivElement>("status");
const errorEl = requireElement<HTMLDivElement>("error");
const loadingEl = requireElement<HTMLDivElement>("loading");

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Harness markup is missing #${id}`);
  }
  return element as T;
}

function fontSpec(family: string): FontSpec {
  return { family, size: 13, weight: "400", lineHeight: 1.2 };
}

/** Keyboard into the engine, and a click readout of the cell under the pointer. */
function wireInput(
  terminal: Terminal,
  feed: (bytes: Uint8Array) => void,
  currentAtlas: () => GlyphAtlas,
): void {
  surface.addEventListener("keydown", (event) => {
    event.preventDefault();
    const bytes = encodeKey(
      event.key,
      event.ctrlKey,
      event.altKey,
      event.shiftKey,
      event.metaKey,
      terminal.applicationCursor,
    );
    if (bytes !== undefined) {
      feed(bytes);
    }
  });

  canvas.addEventListener("mousedown", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const cell = cellAtPixel(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      currentAtlas().cell,
      devicePixelRatio,
    );
    statusEl.textContent = `clicked cell ${cell.line},${cell.column}`;
  });
}

/** The canned byte sequences that exercise the parser. */
function wireFeedButtons(feed: (bytes: Uint8Array) => void): void {
  requireElement<HTMLButtonElement>("feed-text").onclick = () =>
    feed(new TextEncoder().encode("hello from terminal-core\r\n"));
  requireElement<HTMLButtonElement>("feed-colors").onclick = () => {
    let sequence = "";
    for (let color = 0; color < 16; color += 1) {
      sequence += `\x1b[38;5;${color}m██`;
    }
    feed(new TextEncoder().encode(`${sequence}\x1b[0m\r\n`));
  };
  requireElement<HTMLButtonElement>("feed-truecolor").onclick = () =>
    feed(new TextEncoder().encode("\x1b[1;38;2;18;52;86mtrue color bold\x1b[0m\r\n"));
  requireElement<HTMLButtonElement>("feed-clear").onclick = () =>
    feed(new TextEncoder().encode("\x1b[2J\x1b[H"));
}

async function main(): Promise<void> {
  const wasm = (await init()) as InitOutput;

  let atlas = new GlyphAtlas(fontSpec("ui-monospace, monospace"), devicePixelRatio);
  const renderer = await TerminalRenderer.create(canvas, atlas);
  renderer.setPalette(THEMES.dark);

  let terminal = new Terminal(80, 24);

  function resize(): void {
    const bounds = surface.getBoundingClientRect();
    const size = { cssWidth: bounds.width, cssHeight: bounds.height };
    const pixels = pixelSizeFor(size, devicePixelRatio);
    canvas.width = pixels.width;
    canvas.height = pixels.height;

    const grid = gridSizeFor(size, atlas.cell, devicePixelRatio);
    terminal.resize(grid.columns, grid.lines);
  }

  function feed(bytes: Uint8Array): void {
    terminal.feed(bytes);
  }

  function draw(): void {
    // Zero-copy contract: the engine writes the snapshot into its own wasm
    // memory and hands back a pointer. The view must be rebuilt every frame —
    // growing the wasm heap detaches any previously created ArrayBuffer view.
    terminal.refreshSnapshot();
    const packed = new Uint32Array(
      wasm.memory.buffer,
      terminal.snapshotPtr(),
      terminal.snapshotLen(),
    );

    renderer.render({
      columns: terminal.columns,
      lines: terminal.screenLines,
      packed,
    });

    if (loadingEl.hidden === false) {
      loadingEl.hidden = true;
    }

    statusEl.textContent =
      `${terminal.columns}×${terminal.screenLines} cells · ` +
      `cursor ${terminal.cursorLine},${terminal.cursorColumn} · ` +
      `DECCKM ${terminal.applicationCursor ? "on" : "off"} · dpr ${devicePixelRatio}`;

    requestAnimationFrame(draw);
  }

  wireInput(terminal, feed, () => atlas);
  wireFeedButtons(feed);

  requireElement<HTMLSelectElement>("font").onchange = (event) => {
    // Changing font rebuilds the atlas — the glyph shapes themselves changed —
    // and the renderer has to be handed the new one, or it keeps drawing the
    // old glyph shapes at the old cell metrics.
    const family = (event.target as HTMLSelectElement).value;
    atlas = new GlyphAtlas(fontSpec(family), devicePixelRatio);
    renderer.setAtlas(atlas);
    resize();
  };

  requireElement<HTMLSelectElement>("theme").onchange = (event) => {
    // Changing theme does NOT rebuild the atlas: it stores coverage only, and
    // color is resolved per cell in the shader.
    const name = (event.target as HTMLSelectElement).value;
    const palette = THEMES[name];
    if (palette === undefined) {
      throw new Error(`Unknown theme "${name}"`);
    }
    renderer.setPalette(palette);
  };

  new ResizeObserver(resize).observe(surface);
  resize();
  feed(new TextEncoder().encode("terminal-core ready. Type here.\r\n"));
  surface.focus();
  draw();
}

main().catch((error: unknown) => {
  // Startup failed, so no frame will ever clear the loading line: clear it here
  // or the page claims to still be loading under the error message.
  loadingEl.hidden = true;
  errorEl.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
});
