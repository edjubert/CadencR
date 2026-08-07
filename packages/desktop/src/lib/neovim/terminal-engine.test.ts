import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadTerminalEngine, Terminal } from "./terminal-engine";

const require = createRequire(import.meta.url);
const wasmBytes = readFileSync(require.resolve("@cadencr/terminal-core/pkg/terminal_core_bg.wasm"));

describe("loadTerminalEngine", () => {
  it("initializes the wasm module and makes Terminal constructible", async () => {
    await loadTerminalEngine(wasmBytes);
    const terminal = new Terminal(80, 24);
    expect(terminal.columns).toBe(80);
    expect(terminal.screenLines).toBe(24);
  });

  it("is idempotent across concurrent callers", async () => {
    const [first, second] = await Promise.all([
      loadTerminalEngine(wasmBytes),
      loadTerminalEngine(wasmBytes),
    ]);
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
  });
});
