import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  startRoute: vi.fn(),
  pushBufferRoute: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  startRoute: mocks.startRoute,
  pushBufferRoute: mocks.pushBufferRoute,
}));
vi.mock("@/lib/api-errors", () => ({ toastError: mocks.toastError }));

import { useNeovimSpawnTrigger } from "./useCodeMirrorEditorController";

beforeEach(() => {
  mocks.startRoute.mockReset().mockResolvedValue({ version: "0.10.0" });
  mocks.pushBufferRoute.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockReset();
});

describe("useNeovimSpawnTrigger", () => {
  it("calls start then push exactly once per (feature, file) at level 2", async () => {
    const { rerender } = renderHook(
      ({ isNeovimIntegrated }: { isNeovimIntegrated: boolean }) =>
        useNeovimSpawnTrigger(7, "src/main.rs", "fn main() {}\n", isNeovimIntegrated),
      { initialProps: { isNeovimIntegrated: true } },
    );

    await vi.waitFor(() => {
      expect(mocks.startRoute).toHaveBeenCalledTimes(1);
      expect(mocks.pushBufferRoute).toHaveBeenCalledTimes(1);
    });
    expect(mocks.startRoute).toHaveBeenCalledWith("7");
    expect(mocks.pushBufferRoute).toHaveBeenCalledWith("7", {
      file_path: "src/main.rs",
      content: "fn main() {}\n",
    });

    // Simulate the same file "reopening" (e.g. tab switch back) — re-render with
    // the same (feature, file) pair should not trigger a second spawn.
    rerender({ isNeovimIntegrated: true });
    rerender({ isNeovimIntegrated: true });

    expect(mocks.startRoute).toHaveBeenCalledTimes(1);
    expect(mocks.pushBufferRoute).toHaveBeenCalledTimes(1);
  });

  it("does not spawn when not at level 2", async () => {
    renderHook(() => useNeovimSpawnTrigger(7, "src/main.rs", "content", false));

    expect(mocks.startRoute).not.toHaveBeenCalled();
    expect(mocks.pushBufferRoute).not.toHaveBeenCalled();
  });

  it("surfaces a toast and allows retry on failure", async () => {
    mocks.startRoute.mockRejectedValueOnce(new Error("spawn failed"));

    const { rerender } = renderHook(
      ({ isNeovimIntegrated }: { isNeovimIntegrated: boolean }) =>
        useNeovimSpawnTrigger(7, "src/main.rs", "content", isNeovimIntegrated),
      { initialProps: { isNeovimIntegrated: true } },
    );

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
    });
    expect(mocks.pushBufferRoute).not.toHaveBeenCalled();

    // Retry: a subsequent render (e.g. reopening the file) should attempt again.
    mocks.startRoute.mockResolvedValueOnce({ version: "0.10.0" });
    rerender({ isNeovimIntegrated: false });
    rerender({ isNeovimIntegrated: true });

    await vi.waitFor(() => {
      expect(mocks.startRoute).toHaveBeenCalledTimes(2);
    });
  });
});
