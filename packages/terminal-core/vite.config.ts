import { defineConfig } from "vite";

// Serves the standalone harness. The wasm module is built separately by
// `pnpm build` (wasm-pack) into `pkg/`, which the harness imports directly.
export default defineConfig({
  root: "harness",
  server: {
    port: 8123,
    strictPort: true,
    // `pkg/` sits outside the harness root, and filesystem access is what
    // gates that — not `resolve.preserveSymlinks`, which only decides whether
    // a symlink resolves to its target path.
    fs: { allow: [".."] },
  },
});
