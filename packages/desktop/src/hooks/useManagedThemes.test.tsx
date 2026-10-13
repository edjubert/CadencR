import { afterEach, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils";
import { getManagedThemes } from "@/api/generated";
import { ManagedThemeRegistry, useManagedThemes } from "./useManagedThemes";

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/marketplace-gate", () => ({
  get MARKETPLACE_ENABLED() {
    return gate.enabled;
  },
}));
vi.mock("@/api/generated", () => ({ getManagedThemes: vi.fn() }));
afterEach(() => {
  gate.enabled = true;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("rechecks policy through inventory within fifteen minutes even without focus or interaction", async () => {
  vi.useFakeTimers();
  focusManager.setFocused(false);
  vi.mocked(getManagedThemes).mockResolvedValue([]);
  const client = createTestQueryClient();
  const hook = renderHook(() => useManagedThemes(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(getManagedThemes).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(15 * 60_000 - 2));
  expect(getManagedThemes).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(getManagedThemes).toHaveBeenCalledTimes(2);
  hook.unmount();
  await act(() => vi.advanceTimersByTimeAsync(15 * 60_000));
  expect(getManagedThemes).toHaveBeenCalledTimes(2);
  client.clear();
});

it("does not fetch managed marketplace inventory or poll when disabled", async () => {
  gate.enabled = false;
  vi.useFakeTimers();
  const client = createTestQueryClient();
  const hook = renderHook(() => useManagedThemes(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
  expect(getManagedThemes).not.toHaveBeenCalled();
  hook.unmount();
  client.clear();
});

it("mounts no marketplace query observer for the disabled root registry", () => {
  gate.enabled = false;
  const client = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ManagedThemeRegistry />
    </QueryClientProvider>,
  );
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(getManagedThemes).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
});
