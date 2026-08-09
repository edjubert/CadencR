import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useNeovimSpawnTrigger } from "./useCodeMirrorEditorController";

// The level-2 RPC-driven spawn (headless nvim + buffer push) was removed
// along with its backend surface; useNeovimSpawnTrigger is now a no-op
// pending the PTY-backed replacement. This smoke test just confirms the
// hook is still callable with its existing signature.
describe("useNeovimSpawnTrigger", () => {
  it("does not throw for any isNeovimIntegrated value", () => {
    expect(() =>
      renderHook(() => useNeovimSpawnTrigger(7, "src/main.rs", "content", true)),
    ).not.toThrow();
    expect(() =>
      renderHook(() => useNeovimSpawnTrigger(7, "src/main.rs", "content", false)),
    ).not.toThrow();
  });
});
