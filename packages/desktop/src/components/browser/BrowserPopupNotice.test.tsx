import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
  type BrowserPopupRequest,
} from "@/lib/desktop-bridge";
import { BrowserPopupNotice } from "./BrowserPopupNotice";

function request(overrides: Partial<BrowserPopupRequest> = {}): BrowserPopupRequest {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tabId: "tab-1",
    scopeId: 1,
    origin: "https://login.example.com",
    hasPostData: false,
    externalAvailable: true,
    status: "blocked",
    ...overrides,
  };
}

describe("BrowserPopupNotice", () => {
  beforeEach(() => clearDesktopBridgeOverrideForTests());
  afterEach(() => clearDesktopBridgeOverrideForTests());

  it("shows only the active source tab and discloses external isolation", async () => {
    setDesktopBridgeOverrideForTests({
      listBlockedBrowserPopups: vi.fn(async () => [
        request(),
        request({
          id: "22222222-2222-4222-8222-222222222222",
          tabId: "tab-2",
          origin: "https://id.example.com",
        }),
      ]),
      onBrowserPopupRequestsChanged: vi.fn(() => () => undefined),
    });

    render(<BrowserPopupNotice scopeId={1} activeTabId="tab-2" />);

    expect(await screen.findByText(/Popup blocked from https:\/\/id\.example\.com/)).toBeVisible();
    expect(screen.queryByText(/login\.example\.com/)).not.toBeInTheDocument();
    expect(screen.getByText(/transfers neither embedded cookies nor sign-in state/)).toBeVisible();
  });

  it("guards duplicate allow actions and exposes progress", async () => {
    let resolveAllow: (() => void) | undefined;
    const allow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAllow = resolve;
        }),
    );
    setDesktopBridgeOverrideForTests({
      listBlockedBrowserPopups: vi.fn(async () => [request()]),
      allowBrowserPopupOnce: allow,
      onBrowserPopupRequestsChanged: vi.fn(() => () => undefined),
    });
    render(<BrowserPopupNotice scopeId={1} activeTabId="tab-1" />);
    const button = await screen.findByRole("button", { name: "Allow once" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(allow).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute("aria-busy", "true");
    resolveAllow?.();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy", "true"));
  });

  it("dismisses the request through the main-process authority", async () => {
    const dismiss = vi.fn(async () => undefined);
    setDesktopBridgeOverrideForTests({
      listBlockedBrowserPopups: vi.fn(async () => [request()]),
      dismissBrowserPopup: dismiss,
      onBrowserPopupRequestsChanged: vi.fn(() => () => undefined),
    });
    render(<BrowserPopupNotice scopeId={1} activeTabId="tab-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss blocked popup" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(request().id));
  });

  it("drops a stale scope response after rerender", async () => {
    let resolveOld: ((requests: BrowserPopupRequest[]) => void) | undefined;
    const list = vi.fn((scopeId: number) => {
      if (scopeId === 2)
        return Promise.resolve([request({ scopeId: 2, origin: "https://new.example.com" })]);
      return new Promise<BrowserPopupRequest[]>((resolve) => {
        resolveOld = resolve;
      });
    });
    setDesktopBridgeOverrideForTests({
      listBlockedBrowserPopups: list,
      onBrowserPopupRequestsChanged: vi.fn(() => () => undefined),
    });
    const view = render(<BrowserPopupNotice scopeId={1} activeTabId="tab-1" />);
    view.rerender(<BrowserPopupNotice scopeId={2} activeTabId="tab-1" />);

    expect(await screen.findByText(/new\.example\.com/)).toBeVisible();
    resolveOld?.([request({ origin: "https://stale.example.com" })]);
    await Promise.resolve();
    expect(screen.queryByText(/stale\.example\.com/)).not.toBeInTheDocument();
  });
});
