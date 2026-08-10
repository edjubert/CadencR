# terminal-core

In-browser terminal engine for Cadencr's Neovim editor panel. Parses the raw
ANSI byte stream of a PTY into a grid of cells, and encodes keyboard input back
into the bytes a terminal application expects. It does **not** render anything —
drawing the grid is the job of the WebGPU renderer that consumes it.

## Why it exists

Cadencr's Neovim panel runs a real `nvim` in a PTY on the Rust service and
streams its output to the frontend. Something has to turn that byte stream into
a drawable grid. Doing it in wasm, in the renderer process, keeps the whole
path free of per-frame IPC.

## Layout

- `src/terminal.rs` — drives an `alacritty_terminal` grid from ANSI bytes
- `src/input.rs` — browser `KeyboardEvent` → PTY bytes
- `src/snapshot.rs` — packs the grid into a `u32` array for JavaScript
- `src/wasm.rs` — `wasm-bindgen` façade; type conversion only, no logic
- `vendor/alacritty_terminal/` — patched upstream copy, see `vendor/README.md`
- `harness/` — standalone browser harness for manual verification

## Not part of the Cargo workspace

This crate targets `wasm32-unknown-unknown` and depends on a vendored
`alacritty_terminal`, so it is deliberately excluded from the repo's root Cargo
workspace (note the `[workspace]` table in its `Cargo.toml`, which also
excludes `vendor/alacritty_terminal` from this crate's own workspace). Run its
commands from this directory — `pnpm rust -- …` targets the service workspace
and does not apply here.

## Renderer (TypeScript)

The WebGPU renderer lives in `renderer/` and is written in TypeScript, not
Rust. The GPU work is identical either way — same WGSL shaders, same buffers,
same performance — and Rust's value here is the terminal emulation, which the
wasm crate already provides. TypeScript gets direct access to `navigator.gpu`,
Canvas2D, `devicePixelRatio` and `ResizeObserver` without crossing a binding
layer.

- `renderer/atlas-layout.ts` — pure geometry: which glyph occupies which slot,
  texture coordinates, growth. Testable without a browser.
- `renderer/atlas.ts` — Canvas2D rasterizer built on that layout. Glyphs are
  stored as coverage only; color is applied per cell in the shader, so changing
  theme never rebuilds the atlas — only changing font does.

Run `pnpm test` for the TypeScript tests and `cargo test` for the Rust ones.

## Commands

```bash
cargo test                                  # Rust tests — the ANSI engine and input encoding
cargo build --target wasm32-unknown-unknown # compile check for the browser target
pnpm test                                   # TypeScript tests — atlas layout, palette, instance data, metrics
pnpm build                                  # build the wasm module into pkg/
pnpm harness                                # build the wasm module, then serve the harness on :8123
```

`pkg/`, `target/` and `node_modules/` are build artifacts and are gitignored.

## Harness

`harness/` is a standalone browser page that wires the engine, the atlas and
the WebGPU renderer into an interactive terminal. Input loops back on itself —
there is no PTY — which is enough to exercise keyboard → bytes → parser → grid
→ GPU. It is the only way to verify the GPU path, since vitest has no WebGPU
context.

Switching theme in the harness recolors instantly without rebuilding the atlas;
switching font rebuilds it. That difference is the visible proof that the atlas
stores glyph coverage only, with color applied per cell in the shader.
