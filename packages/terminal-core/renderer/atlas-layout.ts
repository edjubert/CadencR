/**
 * Where each glyph lives inside the atlas texture.
 *
 * Pure geometry — no canvas, no drawing — so it is testable without a browser.
 * The rasterizer in `atlas.ts` consumes it.
 */

export interface CellMetrics {
  /** Cell width in physical pixels. */
  width: number;
  /** Cell height in physical pixels. */
  height: number;
}

export interface AtlasSlot {
  /** Sequential slot number, in insertion order. */
  index: number;
  /** Top-left corner of the slot, in physical pixels. */
  x: number;
  y: number;
  /** True the first time a code point is seen — the caller must rasterize it. */
  isNew: boolean;
}

export interface TextureRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** How many rows the texture starts with, before it has to grow. */
const INITIAL_ROWS = 4;

/**
 * Hard ceiling on texture height, in physical pixels.
 *
 * 8192 is WebGPU's guaranteed `maxTextureDimension2D`. Growing past it makes
 * `createTexture` fail deep inside the render path, where the only symptom is a
 * dead canvas; failing here instead names the actual cause.
 */
const MAX_HEIGHT = 8192;

/**
 * Thrown when the atlas cannot fit another glyph. Callers recover by resetting
 * the atlas at a frame boundary — never mid-frame, which would leave already
 * emitted texture coordinates pointing at evicted slots.
 */
export class AtlasFullError extends Error {
  constructor(needed: number) {
    super(
      `Glyph atlas is full: the next glyph needs ${needed}px of texture, over the ${MAX_HEIGHT}px limit.`,
    );
    this.name = "AtlasFullError";
  }
}

export class AtlasLayout {
  readonly cell: CellMetrics;
  readonly width: number;
  readonly columns: number;

  #height: number;
  #slots = new Map<number, number>();

  constructor(cell: CellMetrics, width: number) {
    if (cell.width <= 0) {
      throw new Error(`Atlas cell width must be positive, got ${cell.width}`);
    }
    if (cell.height <= 0) {
      throw new Error(`Atlas cell height must be positive, got ${cell.height}`);
    }
    if (width < cell.width) {
      throw new Error(`Atlas width ${width} cannot hold a single ${cell.width}px cell`);
    }

    this.cell = cell;
    this.width = width;
    this.columns = Math.floor(width / cell.width);
    this.#height = cell.height * INITIAL_ROWS;
  }

  /** Current texture height in physical pixels; grows as slots are added. */
  get height(): number {
    return this.#height;
  }

  /** How many glyphs the atlas currently holds. */
  get size(): number {
    return this.#slots.size;
  }

  /**
   * Forget every allocation and shrink back to the initial height.
   *
   * Every previously returned `TextureRect` becomes meaningless, so this is
   * only safe between frames.
   */
  reset(): void {
    this.#slots.clear();
    this.#height = this.cell.height * INITIAL_ROWS;
  }

  /**
   * The slot for `codePoint`, allocating one if this is the first sighting.
   *
   * `isNew` tells the caller whether it still has to rasterize the glyph — the
   * atlas fills on demand rather than pre-rendering Unicode, which would blow
   * the texture up for no benefit.
   */
  slotFor(codePoint: number): AtlasSlot {
    const existing = this.#slots.get(codePoint);
    if (existing !== undefined) {
      return { ...this.#position(existing), index: existing, isNew: false };
    }

    const index = this.#slots.size;
    this.#slots.set(codePoint, index);

    const row = Math.floor(index / this.columns);
    const neededHeight = (row + 1) * this.cell.height;
    if (neededHeight > MAX_HEIGHT) {
      this.#slots.delete(codePoint);
      throw new AtlasFullError(neededHeight);
    }
    if (neededHeight > this.#height) {
      // Double rather than grow by one row: reallocating a GPU texture is far
      // more expensive than holding some slack.
      this.#height = Math.min(Math.max(this.#height * 2, neededHeight), MAX_HEIGHT);
    }

    return { ...this.#position(index), index, isNew: true };
  }

  /** Normalized texture coordinates for a slot, ready for a shader. */
  uvFor(slot: AtlasSlot): TextureRect {
    return {
      u0: slot.x / this.width,
      v0: slot.y / this.#height,
      u1: (slot.x + this.cell.width) / this.width,
      v1: (slot.y + this.cell.height) / this.#height,
    };
  }

  #position(index: number): { x: number; y: number } {
    return {
      x: (index % this.columns) * this.cell.width,
      y: Math.floor(index / this.columns) * this.cell.height,
    };
  }
}
