/**
 * Rasterizes glyphs into an atlas texture using the browser's own font stack.
 *
 * Drawing through Canvas2D rather than a bundled rasterizer buys font
 * fallback, emoji, ligature-free monospace metrics and every font the user has
 * installed, for free. Glyphs are stored as coverage only — white on
 * transparent — because color is applied per cell in the shader from the theme
 * palette. Changing theme therefore never rebuilds the atlas; changing font
 * does.
 */

import { AtlasFullError, AtlasLayout, type CellMetrics, type TextureRect } from "./atlas-layout";

export interface FontSpec {
  /** CSS font-family list, e.g. "'Fira Code', Menlo, monospace". */
  family: string;
  /** Font size in CSS pixels. */
  size: number;
  /** CSS font-weight, e.g. "400". */
  weight: string;
  /** Multiplier applied to the font size to get the cell height. */
  lineHeight: number;
}

/** Character measured to derive the cell width of a monospace font. */
const REFERENCE_GLYPH = "M";

/** Atlas texture width in physical pixels. */
const ATLAS_WIDTH = 1024;

/** Printable ASCII, pre-rasterized because it covers almost any code screen. */
const PRERASTERIZED = { first: 32, last: 126 };

/**
 * The glyph a cell falls back to when the atlas is out of room. Space is always
 * present — it opens the pre-rasterized range — so this lookup cannot itself
 * fail, and it renders as nothing rather than as a wrong character.
 */
const BLANK_CODE_POINT = 32;

export class GlyphAtlas {
  readonly layout: AtlasLayout;
  readonly font: FontSpec;
  readonly devicePixelRatio: number;

  #canvas: OffscreenCanvas;
  #context: OffscreenCanvasRenderingContext2D;
  #dirty = true;
  #full = false;

  constructor(font: FontSpec, devicePixelRatio: number) {
    this.font = font;
    this.devicePixelRatio = devicePixelRatio;

    const cell = measureCell(font, devicePixelRatio);
    this.layout = new AtlasLayout(cell, ATLAS_WIDTH);

    this.#canvas = new OffscreenCanvas(ATLAS_WIDTH, this.layout.height);
    const context = this.#canvas.getContext("2d");
    if (context === null) {
      throw new Error(
        "Could not get a 2D context for the glyph atlas — the renderer cannot draw text without one.",
      );
    }
    this.#context = context;
    this.#configureContext();
    this.#prerasterize();
  }

  /**
   * Drop every cached glyph and start over.
   *
   * The recovery path when the atlas fills up: a screen holds far fewer
   * distinct code points than the atlas can, so refilling from scratch is
   * always possible. Only safe between frames — every previously returned
   * `TextureRect` becomes meaningless.
   */
  reset(): void {
    this.layout.reset();
    this.#full = false;
    this.#canvas = new OffscreenCanvas(ATLAS_WIDTH, this.layout.height);
    const context = this.#canvas.getContext("2d");
    if (context === null) {
      throw new Error("Could not get a 2D context while resetting the glyph atlas.");
    }
    this.#context = context;
    this.#configureContext();
    this.#prerasterize();
    this.#dirty = true;
  }

  #prerasterize(): void {
    for (let code = PRERASTERIZED.first; code <= PRERASTERIZED.last; code += 1) {
      this.glyph(code);
    }
  }

  get cell(): CellMetrics {
    return this.layout.cell;
  }

  /** Whether the texture changed since the last `markUploaded`. */
  get isDirty(): boolean {
    return this.#dirty;
  }

  /**
   * True once a glyph had to be dropped for lack of room, meaning some cells
   * are rendering blank. Cleared by `reset`.
   */
  get isFull(): boolean {
    return this.#full;
  }

  markUploaded(): void {
    this.#dirty = false;
  }

  /** The texture source to upload to the GPU. */
  get source(): OffscreenCanvas {
    return this.#canvas;
  }

  /**
   * Texture coordinates for `codePoint`, rasterizing it on first sight.
   */
  glyph(codePoint: number): TextureRect {
    let slot;
    try {
      slot = this.layout.slotFor(codePoint);
    } catch (error) {
      if (!(error instanceof AtlasFullError)) {
        throw error;
      }
      // Out of room. Render this cell blank rather than taking the render loop
      // down with it — `isFull` is how the caller learns it happened.
      this.#full = true;
      return this.layout.uvFor(this.layout.slotFor(BLANK_CODE_POINT));
    }

    if (!slot.isNew) {
      return this.layout.uvFor(slot);
    }

    if (this.layout.height > this.#canvas.height) {
      this.#grow();
    }

    // Clip to the slot: a glyph wider than the cell — CJK, emoji, or a fallback
    // face whose advance exceeds the measured "M" — would otherwise paint into
    // the neighbouring slot. Neighbours are rasterized once, so that corruption
    // would never be repaired. Clipping keeps the aspect ratio, unlike the
    // `maxWidth` argument, which condenses the glyph instead.
    this.#context.save();
    this.#context.beginPath();
    this.#context.rect(slot.x, slot.y, this.cell.width, this.cell.height);
    this.#context.clip();
    this.#context.fillText(String.fromCodePoint(codePoint), slot.x, slot.y + this.cell.height / 2);
    this.#context.restore();
    this.#dirty = true;

    return this.layout.uvFor(slot);
  }

  /**
   * Grow the backing canvas, preserving what is already drawn. Resizing an
   * OffscreenCanvas clears it and resets its context state, so the old pixels
   * are copied back and the context reconfigured.
   */
  #grow(): void {
    const previous = this.#canvas;
    const grown = new OffscreenCanvas(ATLAS_WIDTH, this.layout.height);
    const context = grown.getContext("2d");
    if (context === null) {
      throw new Error("Could not get a 2D context while growing the glyph atlas.");
    }

    context.drawImage(previous, 0, 0);
    this.#canvas = grown;
    this.#context = context;
    this.#configureContext();
    this.#dirty = true;
  }

  #configureContext(): void {
    const pixelSize = this.font.size * this.devicePixelRatio;
    this.#context.font = `${this.font.weight} ${pixelSize}px ${this.font.family}`;
    this.#context.textBaseline = "middle";
    // Coverage only: the shader tints this with the cell's theme color.
    this.#context.fillStyle = "#ffffff";
  }
}

/**
 * Derive cell size from the font itself rather than assuming a ratio, so a
 * user-chosen font lays out correctly.
 */
export function measureCell(font: FontSpec, devicePixelRatio: number): CellMetrics {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error(
      "Could not get a 2D context to measure the font — cell size is unknowable without it.",
    );
  }

  const pixelSize = font.size * devicePixelRatio;
  context.font = `${font.weight} ${pixelSize}px ${font.family}`;
  const width = context.measureText(REFERENCE_GLYPH).width;

  return {
    width: Math.ceil(width),
    height: Math.ceil(pixelSize * font.lineHeight),
  };
}
