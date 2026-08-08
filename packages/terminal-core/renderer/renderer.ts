/**
 * WebGPU pipeline that draws a terminal grid.
 *
 * Deliberately does not own an animation loop: it exposes `render()` and the
 * caller decides when to draw, so a hidden panel can simply stop calling it.
 */

import type { CellMetrics } from "./atlas-layout";
import { buildInstanceData, FLOATS_PER_INSTANCE, type GlyphSource } from "./instance-data";
import { buildPaletteBuffer, PALETTE_ENTRIES } from "./palette";
import { TERMINAL_SHADER } from "./terminal-shader.wgsl";

export interface RendererGrid {
  columns: number;
  lines: number;
  /** Packed snapshot: four u32 per cell. Rebuild it after every engine call. */
  packed: Uint32Array;
}

export interface AtlasTexture extends GlyphSource {
  readonly source: OffscreenCanvas;
  readonly isDirty: boolean;
  /** Physical-pixel size of one cell — the renderer draws at exactly this size. */
  readonly cell: CellMetrics;
  markUploaded(): void;
}

const BYTES_PER_FLOAT = 4;

export class TerminalRenderer {
  #device: GPUDevice;
  #context: GPUCanvasContext;
  #pipeline: GPURenderPipeline;
  #atlas: AtlasTexture;

  #uniformBuffer: GPUBuffer;
  #paletteBuffer: GPUBuffer;
  #instanceBuffer: GPUBuffer | undefined;
  #instanceCapacity = 0;
  #texture: GPUTexture | undefined;
  #sampler: GPUSampler;

  private constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    atlas: AtlasTexture,
  ) {
    this.#device = device;
    this.#context = context;
    this.#pipeline = pipeline;
    this.#atlas = atlas;

    this.#uniformBuffer = device.createBuffer({
      size: 4 * BYTES_PER_FLOAT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#paletteBuffer = device.createBuffer({
      size: PALETTE_ENTRIES * 4 * BYTES_PER_FLOAT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  /**
   * Acquire a GPU device and build the pipeline.
   *
   * Throws — loudly — when WebGPU is unavailable. There is deliberately no
   * fallback: silently degrading would hide a real driver or configuration
   * problem behind a mysteriously slow editor.
   */
  static async create(canvas: HTMLCanvasElement, atlas: AtlasTexture): Promise<TerminalRenderer> {
    if (navigator.gpu === undefined) {
      throw new Error(
        "WebGPU is unavailable in this environment, so the terminal cannot be rendered.",
      );
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) {
      throw new Error("No WebGPU adapter available — the GPU driver may be unsupported.");
    }
    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");
    if (context === null) {
      throw new Error("Could not acquire a WebGPU context from the canvas.");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      // Translucent themes paint a transparent terminal background, mirroring
      // what the existing shell terminal does with allowTransparency.
      alphaMode: "premultiplied",
    });

    const module = device.createShaderModule({ code: TERMINAL_SHADER });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [
          {
            arrayStride: FLOATS_PER_INSTANCE * BYTES_PER_FLOAT,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
              { shaderLocation: 1, offset: 2 * BYTES_PER_FLOAT, format: "float32x4" },
              { shaderLocation: 2, offset: 6 * BYTES_PER_FLOAT, format: "float32x4" },
              { shaderLocation: 3, offset: 10 * BYTES_PER_FLOAT, format: "float32x4" },
              { shaderLocation: 4, offset: 14 * BYTES_PER_FLOAT, format: "float32" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });

    return new TerminalRenderer(device, context, pipeline, atlas);
  }

  /** Replace the theme. Rewrites one uniform buffer; never touches the atlas. */
  setPalette(overrides: Map<number, string>): void {
    this.#device.queue.writeBuffer(
      this.#paletteBuffer,
      0,
      buildPaletteBuffer(overrides).buffer as ArrayBuffer,
    );
  }

  /** Draw one frame. */
  render(grid: RendererGrid): void {
    this.#uploadAtlasIfDirty();

    const instances = buildInstanceData(grid.packed, grid.columns, grid.lines, this.#atlas);
    this.#ensureInstanceCapacity(instances.byteLength);
    const instanceBuffer = this.#instanceBuffer;
    if (instanceBuffer === undefined) {
      throw new Error("Instance buffer was not allocated before rendering.");
    }
    this.#device.queue.writeBuffer(instanceBuffer, 0, instances.buffer as ArrayBuffer);

    // Cells are sized from the atlas, not from `1 / columns`. Deriving the size
    // from the column count stretches the grid to fill the canvas, resampling
    // every glyph off its rasterized size — the whole screen reads as blurry.
    // Drawing at the exact cell size keeps texels 1:1 with pixels and leaves
    // the sub-cell remainder as padding.
    const canvas = this.#context.canvas;
    const cell = this.#atlas.cell;
    this.#device.queue.writeBuffer(
      this.#uniformBuffer,
      0,
      new Float32Array([
        grid.columns,
        grid.lines,
        cell.width / canvas.width,
        cell.height / canvas.height,
      ]),
    );

    const texture = this.#texture;
    if (texture === undefined) {
      throw new Error("Glyph atlas texture was not uploaded before rendering.");
    }

    const bindGroup = this.#device.createBindGroup({
      layout: this.#pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#uniformBuffer } },
        { binding: 1, resource: { buffer: this.#paletteBuffer } },
        { binding: 2, resource: texture.createView() },
        { binding: 3, resource: this.#sampler },
      ],
    });

    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, instanceBuffer);
    // Six vertices per quad, one instance per cell: the whole grid in one call.
    pass.draw(6, grid.columns * grid.lines);
    pass.end();

    this.#device.queue.submit([encoder.finish()]);
  }

  #uploadAtlasIfDirty(): void {
    if (this.#texture !== undefined && !this.#atlas.isDirty) {
      return;
    }

    const source = this.#atlas.source;
    this.#texture?.destroy();
    this.#texture = this.#device.createTexture({
      size: [source.width, source.height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.#device.queue.copyExternalImageToTexture({ source }, { texture: this.#texture }, [
      source.width,
      source.height,
    ]);
    this.#atlas.markUploaded();
  }

  #ensureInstanceCapacity(byteLength: number): void {
    if (this.#instanceBuffer !== undefined && this.#instanceCapacity >= byteLength) {
      return;
    }
    this.#instanceBuffer?.destroy();
    this.#instanceBuffer = this.#device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.#instanceCapacity = byteLength;
  }
}
