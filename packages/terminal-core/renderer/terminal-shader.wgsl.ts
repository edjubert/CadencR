/**
 * WGSL for the terminal grid.
 *
 * One instance per cell. The vertex stage expands each instance into a quad
 * from `vertex_index` alone — no vertex buffer — and the fragment stage blends
 * background and foreground using the glyph's alpha coverage from the atlas.
 * Background and glyph therefore draw in one pass, not two.
 */
export const TERMINAL_SHADER = /* wgsl */ `
struct Uniforms {
  // Grid size in cells.
  grid: vec2<f32>,
  // Cell size in normalized device units.
  cell: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> palette: array<vec4<f32>, 288>;
@group(0) @binding(2) var atlasTexture: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) foreground: vec4<f32>,
  @location(2) background: vec4<f32>,
};

// Bit 0 of the cell flags word, matching alacritty's Flags::INVERSE.
const FLAG_INVERSE: u32 = 1u;

fn resolveColor(color: vec4<f32>) -> vec4<f32> {
  // w == 1 marks a palette index stored in x; otherwise xyz is literal rgb.
  if (color.w > 0.5) {
    return palette[u32(color.x)];
  }
  return vec4<f32>(color.xyz, 1.0);
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) cellPosition: vec2<f32>,
  @location(1) foreground: vec4<f32>,
  @location(2) background: vec4<f32>,
  @location(3) glyphRect: vec4<f32>,
  @location(4) flags: f32,
) -> VertexOutput {
  // Two triangles covering the unit square, from the vertex index alone.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
  );
  let corner = corners[vertexIndex];

  // Cell space to clip space: origin top-left, y downwards.
  let topLeft = (cellPosition + corner) * uniforms.cell;
  let clip = vec2<f32>(topLeft.x * 2.0 - 1.0, 1.0 - topLeft.y * 2.0);

  var output: VertexOutput;
  output.position = vec4<f32>(clip, 0.0, 1.0);
  output.uv = mix(glyphRect.xy, glyphRect.zw, corner);

  var resolvedForeground = resolveColor(foreground);
  var resolvedBackground = resolveColor(background);

  // Inverse swaps the two, which is what makes a block cursor and a selection
  // free — no cell rewriting on the CPU.
  if ((u32(flags) & FLAG_INVERSE) != 0u) {
    let swapped = resolvedForeground;
    resolvedForeground = resolvedBackground;
    resolvedBackground = swapped;
  }

  output.foreground = resolvedForeground;
  output.background = resolvedBackground;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  // The atlas stores coverage only; color comes from the theme.
  let coverage = textureSample(atlasTexture, atlasSampler, input.uv).a;
  return mix(input.background, input.foreground, coverage);
}
`;
