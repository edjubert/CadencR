import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getListFeaturePortsQueryKey, type FeaturePorts } from "@/api/generated";
import { useConnectionStatusStore } from "@/stores/connection-status-store";
import { server } from "@/test/msw-server";
import { useFeaturePorts } from "./useFeaturePorts";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));

const snapshot: FeaturePorts[] = [
  { feature_id: 7, ports: [{ port: 3000, pid: 42, process: "node", source: "terminal" }] },
  { feature_id: 8, ports: [{ port: 4000, pid: 43, process: "node", source: "agent" }] },
];
const queryKey = [...getListFeaturePortsQueryKey(), null];
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
  });
  useConnectionStatusStore.setState({ status: "connected", lastConnectedAt: null, sources: {} });
  server.use(http.get("*/api/features/ports", () => HttpResponse.json(snapshot)));
});

afterEach(() => {
  client.clear();
  focusManager.setFocused(undefined);
});

describe("useFeaturePorts live snapshots", () => {
  it("waits for a new scan instead of displaying a cached snapshot on mount", async () => {
    client.setQueryData(queryKey, snapshot);
    server.use(http.get("*/api/features/ports", () => HttpResponse.json([])));

    const { result } = renderHook(useFeaturePorts, { wrapper });

    expect(result.current.size).toBe(0);
    await waitFor(() => expect(client.getQueryData(queryKey)).toEqual([]));
    expect(result.current.size).toBe(0);
  });

  it("removes terminal and agent ports when the next scan no longer finds them", async () => {
    const { result } = renderHook(useFeaturePorts, { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    server.use(http.get("*/api/features/ports", () => HttpResponse.json([])));

    await act(() => client.refetchQueries({ queryKey }));

    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("does not present the last successful scan as live after a scan fails", async () => {
    const { result } = renderHook(useFeaturePorts, { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    server.use(
      http.get("*/api/features/ports", () =>
        HttpResponse.json({ error: "scan failed" }, { status: 500 }),
      ),
    );

    await act(() => client.refetchQueries({ queryKey }));

    await waitFor(() => expect(result.current.size).toBe(0));
    expect(client.getQueryData(queryKey)).toEqual(snapshot);
    expect(toast.error).toHaveBeenCalled();
    server.use(http.get("*/api/features/ports", () => HttpResponse.json(snapshot)));
    await act(() => client.refetchQueries({ queryKey }));
    await waitFor(() => expect(result.current.size).toBe(2));
  });

  it("hides ports on disconnect and confirms them again after a service restart", async () => {
    const { result } = renderHook(useFeaturePorts, { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    act(() => useConnectionStatusStore.getState().reportSource("health", "disconnected"));
    expect(result.current.size).toBe(0);
    server.use(http.get("*/api/features/ports", () => HttpResponse.json([])));

    act(() => useConnectionStatusStore.getState().reportSource("health", "connected"));

    expect(result.current.size).toBe(0);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(result.current.size).toBe(0);
  });

  it("rescans immediately when the window becomes visible again", async () => {
    const { result } = renderHook(useFeaturePorts, { wrapper });
    await waitFor(() => expect(result.current.size).toBe(2));
    act(() => focusManager.setFocused(false));
    server.use(http.get("*/api/features/ports", () => HttpResponse.json([])));

    act(() => focusManager.setFocused(true));

    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("cannot revive a pre-disconnect scan that completes after reconnect", async () => {
    let releaseOldScan!: () => void;
    const oldScan = new Promise<void>((resolve) => {
      releaseOldScan = resolve;
    });
    let releaseNewScan!: () => void;
    const newScan = new Promise<void>((resolve) => {
      releaseNewScan = resolve;
    });
    const requests = vi.fn();
    server.use(
      http.get("*/api/features/ports", async () => {
        requests();
        if (requests.mock.calls.length === 1) {
          await oldScan;
          return HttpResponse.json(snapshot);
        }
        await newScan;
        return HttpResponse.json(snapshot.slice(1));
      }),
    );
    const { result } = renderHook(useFeaturePorts, { wrapper });
    await waitFor(() => expect(requests).toHaveBeenCalledOnce());

    act(() => useConnectionStatusStore.getState().reportSource("health", "disconnected"));
    act(() => useConnectionStatusStore.getState().reportSource("health", "connected"));
    await act(async () => releaseOldScan());

    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    expect(result.current.size).toBe(0);
    await act(async () => releaseNewScan());
    await waitFor(() => expect([...result.current.keys()]).toEqual([8]));
  });
});
