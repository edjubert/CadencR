import { describe, expect, it, vi } from "vitest";
import { dispatchNeovimEnvelope, subscribeToNeovimEvents } from "./ws-neovim-store";

describe("subscribeToNeovimEvents", () => {
  it("calls onCursorMoved only for matching file_path", () => {
    const onCursorMoved = vi.fn();
    const unsubscribe = subscribeToNeovimEvents("feature-1", "src/main.rs", {
      onCursorMoved,
      onModeChanged: vi.fn(),
      onBufferLinesChanged: vi.fn(),
    });

    dispatchNeovimEnvelope("feature-1", {
      action: "cursor_moved",
      payload: { file_path: "src/main.rs", line: 3, col: 0 },
    });
    dispatchNeovimEnvelope("feature-1", {
      action: "cursor_moved",
      payload: { file_path: "other.rs", line: 9, col: 1 },
    });

    expect(onCursorMoved).toHaveBeenCalledTimes(1);
    expect(onCursorMoved).toHaveBeenCalledWith(3, 0);

    unsubscribe();
  });

  it("dispatches mode_changed and buffer_lines_changed to the matching handler", () => {
    const onModeChanged = vi.fn();
    const onBufferLinesChanged = vi.fn();
    const unsubscribe = subscribeToNeovimEvents("feature-2", "src/lib.rs", {
      onCursorMoved: vi.fn(),
      onModeChanged,
      onBufferLinesChanged,
    });

    dispatchNeovimEnvelope("feature-2", {
      action: "mode_changed",
      payload: { file_path: "src/lib.rs", mode: "insert" },
    });
    dispatchNeovimEnvelope("feature-2", {
      action: "buffer_lines_changed",
      payload: {
        file_path: "src/lib.rs",
        firstline: 1,
        lastline: 2,
        lines: ["replaced line"],
      },
    });

    expect(onModeChanged).toHaveBeenCalledWith("insert");
    expect(onBufferLinesChanged).toHaveBeenCalledWith(1, 2, ["replaced line"]);

    unsubscribe();
  });

  it("stops delivering events after unsubscribe", () => {
    const onCursorMoved = vi.fn();
    const unsubscribe = subscribeToNeovimEvents("feature-3", "src/main.rs", {
      onCursorMoved,
      onModeChanged: vi.fn(),
      onBufferLinesChanged: vi.fn(),
    });
    unsubscribe();

    dispatchNeovimEnvelope("feature-3", {
      action: "cursor_moved",
      payload: { file_path: "src/main.rs", line: 1, col: 0 },
    });

    expect(onCursorMoved).not.toHaveBeenCalled();
  });
});
