// @vitest-environment happy-dom
import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDebouncedSetting } from "./useDebouncedSetting";

const mockMutateAsync = vi.fn();
const mockToastError = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockUseQuery = vi.fn((): { data: { value: string } | null; isLoading: boolean } => ({
  data: { value: "stored-value" },
  isLoading: false,
}));

vi.mock("../api/generated", () => ({
  useGetWorkspaceSetting: () => mockUseQuery(),
  useSetWorkspaceSetting: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  getGetWorkspaceSettingQueryKey: vi.fn((key: string) => ["workspace", "settings", key]),
}));

vi.mock("sonner", () => ({
  toast: { error: (message: string) => mockToastError(message) },
}));

const mockSetQueryData = vi.fn();
const mockGetQueryData = vi.fn();
let mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  getQueryData: mockGetQueryData,
  setQueryData: mockSetQueryData,
};

function deferredWrite() {
  let resolve!: (value: { value: string }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ value: string }>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => mockQueryClient),
  };
});

describe("useDebouncedSetting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    mockToastError.mockClear();
    mockInvalidateQueries.mockClear();
    mockSetQueryData.mockClear();
    mockGetQueryData.mockClear();
    mockGetQueryData.mockReturnValue({ value: "stored-value" });
    mockUseQuery.mockReturnValue({ data: { value: "stored-value" }, isLoading: false });
    mockQueryClient = {
      invalidateQueries: mockInvalidateQueries,
      getQueryData: mockGetQueryData,
      setQueryData: mockSetQueryData,
    };
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await Promise.resolve();
    });
    vi.useRealTimers();
  });

  it("returns the stored value from the query", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key"));
    expect(result.current.value).toBe("stored-value");
  });

  it("keeps the setter stable when the mutation result object is recreated", () => {
    const { result, rerender } = renderHook(() => useDebouncedSetting("my-key"));
    const initialSetter = result.current.setValue;

    rerender();

    expect(result.current.setValue).toBe(initialSetter);
  });

  it("does not call mutate immediately on setValue", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key"));
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("calls mutate after debounce delay", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("new-value");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ key: "my-key", data: { value: "new-value" } });
  });

  it("flushes the pending write on unmount instead of dropping it", () => {
    const { result, unmount } = renderHook(() => useDebouncedSetting("my-key", 500));
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    unmount();
    expect(mockMutateAsync).toHaveBeenCalledWith({ key: "my-key", data: { value: "new-value" } });
  });

  it("restores the cache and toasts when a write flushed on unmount is rejected", async () => {
    mockMutateAsync.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const { result, unmount } = renderHook(() => useDebouncedSetting("my-key", 500));
    act(() => {
      result.current.setValue("new-value");
    });
    unmount();
    // Let the rejection handlers run (they fire after unmount, so per-call
    // mutate callbacks would never see them).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "stored-value",
    });
    expect(mockToastError).toHaveBeenCalledWith('Could not save setting "my-key": boom');
  });

  it("persists immediately when debounce is zero", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 0));
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ key: "my-key", data: { value: "new-value" } });
  });

  it("prevents an older failure after newer success by serializing writes", async () => {
    const first = deferredWrite();
    const second = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useDebouncedSetting("my-key", 0));
    act(() => {
      result.current.setValue("first-value");
      result.current.setValue("second-value");
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error("boom"));
    });
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
      key: "my-key",
      data: { value: "second-value" },
    });
    expect(mockSetQueryData).toHaveBeenCalledTimes(2);
    expect(mockToastError).toHaveBeenCalledWith('Could not save setting "my-key": boom');
    await act(async () => {
      second.resolve({ value: "second-value" });
    });
    expect(mockSetQueryData).toHaveBeenCalledTimes(2);
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "second-value",
    });
  });

  it("protects a newer draft before its debounce expires when an older save fails", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("first-value");
      vi.advanceTimersByTime(300);
      result.current.setValue("second-value");
    });
    await act(async () => {
      first.reject(new Error("boom"));
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockSetQueryData).toHaveBeenCalledTimes(2);
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "second-value",
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it("does not publish an older success over a newer unpersisted edit", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() =>
      useDebouncedSetting("my-key", 300, { immediateCache: false }),
    );
    act(() => {
      result.current.setValue("first-value");
      vi.advanceTimersByTime(300);
      result.current.setValue("second-value");
    });
    await act(async () => {
      first.resolve({ value: "first-value" });
    });
    expect(mockSetQueryData).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "second-value",
    });
  });

  it.each([true, false])(
    "restores the last confirmed success if the newer save fails (immediateCache=%s)",
    async (immediateCache) => {
      const first = deferredWrite();
      mockMutateAsync
        .mockReturnValueOnce(first.promise)
        .mockRejectedValueOnce(new Error("second failed"));
      const { result } = renderHook(() => useDebouncedSetting("my-key", 0, { immediateCache }));
      act(() => {
        result.current.setValue("first-value");
        result.current.setValue("second-value");
      });
      await act(async () => {
        first.resolve({ value: "first-value" });
      });
      expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
        value: "first-value",
      });
      expect(mockToastError).toHaveBeenCalledWith('Could not save setting "my-key": second failed');
    },
  );

  it("restores the original confirmed value when successive saves both fail", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("second"));
    const { result } = renderHook(() => useDebouncedSetting("my-key", 0));
    act(() => {
      result.current.setValue("first-value");
      mockGetQueryData.mockReturnValue({ value: "first-value" });
      result.current.setValue("second-value");
    });
    await act(async () => {
      first.reject(new Error("first"));
    });
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "stored-value",
    });
    expect(mockToastError).toHaveBeenCalledTimes(2);
  });

  it("keeps writes ordered across unmount and remount for the same setting", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise);
    const initial = renderHook(() => useDebouncedSetting("my-key", 0));
    act(() => {
      initial.result.current.setValue("first-value");
    });
    initial.unmount();
    const next = renderHook(() => useDebouncedSetting("my-key", 0));
    expect(next.result.current.isSaving).toBe(false);
    act(() => {
      next.result.current.setValue("second-value");
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(next.result.current.isSaving).toBe(true);
    await act(async () => {
      first.reject(new Error("first"));
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    expect(mockSetQueryData).toHaveBeenLastCalledWith(["workspace", "settings", "my-key"], {
      value: "second-value",
    });
    expect(next.result.current.isSaving).toBe(false);
  });

  it("flushes a pending edit behind an in-flight write on unmount", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise);
    const { result, unmount } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("first-value");
      vi.advanceTimersByTime(300);
      result.current.setValue("second-value");
    });
    unmount();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ value: "first-value" });
    });
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
      key: "my-key",
      data: { value: "second-value" },
    });
  });

  it("does not block writes for a different setting", async () => {
    const first = deferredWrite();
    mockMutateAsync.mockReturnValueOnce(first.promise);
    const a = renderHook(() => useDebouncedSetting("a", 0));
    const b = renderHook(() => useDebouncedSetting("b", 0));
    act(() => {
      a.result.current.setValue("a-value");
      b.result.current.setValue("b-value");
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
    await act(async () => {
      first.resolve({ value: "a-value" });
    });
  });

  it("debounces multiple rapid calls — only calls mutate once", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 300));
    act(() => {
      result.current.setValue("val1");
      result.current.setValue("val2");
      result.current.setValue("val3");
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({ key: "my-key", data: { value: "val3" } });
  });

  it("uses custom debounce interval", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key", 1000));
    act(() => {
      result.current.setValue("hello");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("returns null when query returns no data", () => {
    mockUseQuery.mockReturnValueOnce({ data: null, isLoading: false });
    const { result } = renderHook(() => useDebouncedSetting("missing-key"));
    expect(result.current.value).toBeNull();
  });

  it("updates query cache immediately by default", () => {
    const { result } = renderHook(() => useDebouncedSetting("my-key"));
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockSetQueryData).toHaveBeenCalledWith(["workspace", "settings", "my-key"], {
      value: "new-value",
    });
  });

  it("skips immediate cache update when immediateCache is false", () => {
    const { result } = renderHook(() =>
      useDebouncedSetting("my-key", 300, { immediateCache: false }),
    );
    act(() => {
      result.current.setValue("new-value");
    });
    expect(mockSetQueryData).not.toHaveBeenCalled();
    // But mutation still fires after debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ key: "my-key", data: { value: "new-value" } });
  });

  it("isLoading reflects query loading state", () => {
    mockUseQuery.mockReturnValueOnce({ data: null, isLoading: true });
    const { result } = renderHook(() => useDebouncedSetting("loading-key"));
    expect(result.current.isLoading).toBe(true);
  });
});
