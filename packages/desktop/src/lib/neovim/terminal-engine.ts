/**
 * Loads the terminal-core wasm module.
 *
 * A thin wrapper so callers never import from `@cadencr/terminal-core/pkg/`
 * directly — that path is a build artifact (wasm-pack output), not part of
 * the package's stable API surface.
 */

import init, {
  Terminal,
  encodeKey,
  encodeMouse,
} from "@cadencr/terminal-core/pkg/terminal_core.js";
import type { InitInput } from "@cadencr/terminal-core/pkg/terminal_core.js";

let initialized: Promise<void> | undefined;

// Exposes the wasm module's linear memory so callers can build zero-copy
// views onto the packed grid (see terminal-core's own note on this: the view
// must be rebuilt after every `feed`/`resize`, never cached).
declare global {
  // eslint-disable-next-line no-var
  var __cadencrTerminalCoreMemory: (() => WebAssembly.Memory) | undefined;
}

/**
 * Initialize the wasm module, once per process. Safe to call from multiple
 * components mounting concurrently — they all await the same promise.
 *
 * `input` is optional: browser callers rely on the module's own URL
 * resolution. Node test runners cannot fetch that URL (vitest rewrites
 * `import.meta.url` to a dead dev-server address), so tests pass the wasm
 * bytes read from disk instead.
 *
 * Throws when WebAssembly cannot be instantiated (e.g. a CSP without
 * `'wasm-unsafe-eval'`), rather than silently leaving the caller with an
 * unusable module.
 */
export async function loadTerminalEngine(input?: InitInput): Promise<void> {
  if (initialized === undefined) {
    initialized = init(input).then((instance) => {
      globalThis.__cadencrTerminalCoreMemory = () => instance.memory;
    });
  }
  await initialized;
}

export type TerminalConstructor = typeof Terminal;
export { Terminal, encodeKey, encodeMouse };
