import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useClaudeCodeOauthUsage } from "./useClaudeCodeOauthUsage";
import * as generated from "@/api/generated";

vi.mock("@/api/generated", async () => {
  const actual = await vi.importActual<typeof generated>("@/api/generated");
  return { ...actual, useGetClaudeCodeOauthUsage: vi.fn() };
});

describe("useClaudeCodeOauthUsage", () => {
  it("is disabled (no fetch) when enabled=false", () => {
    const mocked = vi.mocked(generated.useGetClaudeCodeOauthUsage);
    mocked.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof generated.useGetClaudeCodeOauthUsage>);

    renderHook(() => useClaudeCodeOauthUsage(false));

    expect(mocked).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
  });

  it("maps an available response", async () => {
    const mocked = vi.mocked(generated.useGetClaudeCodeOauthUsage);
    mocked.mockReturnValue({
      data: {
        status: "available",
        snapshot: {
          five_hour: { utilization: 0.42 },
          seven_day: { utilization: 0.1 },
          seven_day_sonnet: { utilization: 0.05 },
          seven_day_opus: { utilization: 0 },
        },
        fetched_at: 1_700_000_000,
      },
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof generated.useGetClaudeCodeOauthUsage>);

    const { result } = renderHook(() => useClaudeCodeOauthUsage(true));

    await waitFor(() => {
      expect(result.current.status).toBe("available");
    });
    expect(result.current.snapshot?.five_hour.utilization).toBe(0.42);
    expect(result.current.fetchedAt).toBe(1_700_000_000);
  });

  it("refresh() is a no-op while a fetch is already in flight", () => {
    const refetch = vi.fn();
    const forceCall = vi.spyOn(generated, "getClaudeCodeOauthUsage");
    const mocked = vi.mocked(generated.useGetClaudeCodeOauthUsage);
    mocked.mockReturnValue({
      data: undefined,
      isFetching: true,
      refetch,
    } as unknown as ReturnType<typeof generated.useGetClaudeCodeOauthUsage>);

    const { result } = renderHook(() => useClaudeCodeOauthUsage(true));
    result.current.refresh();

    expect(forceCall).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
    expect(result.current.isRefreshing).toBe(true);
  });

  it("refresh() calls the endpoint with force=true, then refetches the polled query", async () => {
    const refetch = vi.fn();
    const mocked = vi.mocked(generated.useGetClaudeCodeOauthUsage);
    mocked.mockReturnValue({
      data: undefined,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof generated.useGetClaudeCodeOauthUsage>);
    const forceCall = vi
      .spyOn(generated, "getClaudeCodeOauthUsage")
      .mockResolvedValue({ status: "available", fetched_at: 0 } as generated.OauthUsageResponse);

    const { result } = renderHook(() => useClaudeCodeOauthUsage(true));
    result.current.refresh();

    await waitFor(() => {
      expect(forceCall).toHaveBeenCalledWith({ force: true });
      expect(refetch).toHaveBeenCalled();
    });
  });
});
