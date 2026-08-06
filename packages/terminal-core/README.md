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
workspace (note the empty `[workspace]` table in its `Cargo.toml`). Run its
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
cargo test                                  # native tests — all logic is covered here
cargo build --target wasm32-unknown-unknown # compile check for the browser target
wasm-pack build --target web --out-dir pkg  # build the loadable module
python3 -m http.server 8123                 # then open /harness/index.html
```

`pkg/` and `target/` are build artifacts and are gitignored.
