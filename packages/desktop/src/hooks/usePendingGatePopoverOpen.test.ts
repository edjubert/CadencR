// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIDEBAR_CONFIG } from "@/lib/sidebar-config";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { usePendingGatePopoverHoverStore } from "@/stores/pending-gate-popover-hover-store";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { usePendingGatePopoverOpen } from "./usePendingGatePopoverOpen";

const FEATURE_ID = 42;

function seedPendingGate(): void {
  useSessionStatusStore.setState({
    bySession: {
      7: {
        status: "question",
        kind: "permission",
        requestId: "request-1",
        featureId: FEATURE_ID,
        seq: 1,
      },
    },
  });
}

describe("usePendingGatePopoverOpen", () => {
  afterEach(() => {
    useSessionStatusStore.setState({ bySession: {} });
    usePendingGatePopoverHoverStore.setState({ hoveredFeatureId: null });
  });

  it("auto-opens the most recent pending gate for an inactive conversation", () => {
    seedPendingGate();
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, true));
    expect(result.current.open).toBe(true);
  });

  it("does not auto-open for the currently open conversation", () => {
    seedPendingGate();
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, false));
    expect(result.current.open).toBe(false);
  });

  it("closes an auto-opened popover when its conversation becomes active", async () => {
    seedPendingGate();
    usePendingGatePopoverHoverStore.setState({ hoveredFeatureId: FEATURE_ID });
    const { result, rerender } = renderHook(
      ({ allowAutoOpen }) => usePendingGatePopoverOpen(FEATURE_ID, allowAutoOpen),
      { initialProps: { allowAutoOpen: true } },
    );
    expect(result.current.open).toBe(true);

    rerender({ allowAutoOpen: false });
    await waitFor(() => expect(result.current.open).toBe(false));
    expect(usePendingGatePopoverHoverStore.getState().hoveredFeatureId).toBeNull();
  });

  it("still allows the active conversation's popover to be opened manually", () => {
    seedPendingGate();
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, false));

    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
  });
});

describe("usePendingGatePopoverOpen modes", () => {
  afterEach(() => {
    vi.useRealTimers();
    useSessionStatusStore.setState({ bySession: {} });
    useSidebarConfigStore.setState({ config: DEFAULT_SIDEBAR_CONFIG });
  });

  it("doesn't auto-open in click mode and offers no hover handlers", () => {
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, gatePopover: "click" },
    });
    seedPendingGate();
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, true));
    expect(result.current.open).toBe(false);
    expect(result.current.hoverHandlers).toBeUndefined();
  });

  it("opens after a short hover in hover mode and closes once the pointer leaves", () => {
    vi.useFakeTimers();
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, gatePopover: "hover" },
    });
    seedPendingGate();
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, true));
    expect(result.current.open).toBe(false);

    act(() => result.current.hoverHandlers?.onPointerEnter());
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.open).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.open).toBe(true);

    act(() => result.current.hoverHandlers?.onPointerLeave());
    // Reaching the popover in time keeps it open.
    act(() => result.current.hoverHandlers?.onPointerEnter());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.open).toBe(true);
    act(() => result.current.hoverHandlers?.onPointerLeave());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.open).toBe(false);
  });

  it("keeps an older request's popover open through the hover grace delay", () => {
    vi.useFakeTimers();
    useSidebarConfigStore.setState({
      config: { ...DEFAULT_SIDEBAR_CONFIG, gatePopover: "hover" },
    });
    useSessionStatusStore.setState({
      bySession: {
        7: {
          status: "question",
          kind: "permission",
          requestId: "old",
          featureId: FEATURE_ID,
          seq: 1,
        },
        8: { status: "question", kind: "question", requestId: "new", featureId: 99, seq: 5 },
      },
    });
    const { result } = renderHook(() => usePendingGatePopoverOpen(FEATURE_ID, true));
    act(() => result.current.hoverHandlers?.onPointerEnter());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.open).toBe(true);

    // Into the popover and out again: the content hover ends, the grace delay runs.
    act(() => usePendingGatePopoverHoverStore.getState().setHovered(FEATURE_ID));
    act(() => usePendingGatePopoverHoverStore.getState().setHovered(null));
    act(() => result.current.hoverHandlers?.onPointerLeave());
    expect(result.current.open).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.open).toBe(false);
  });
});
