import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
  type BrowserSiteInfo,
  type BrowserTabMetadata,
} from "@/lib/desktop-bridge";
import { useBrowserSiteInfo } from "./useBrowserSiteInfo";
import { BrowserSiteInformation } from "./BrowserSiteInformation";

function tab(id: string, url: string): BrowserTabMetadata {
  return {
    id,
    title: id,
    url,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "default",
    isActive: true,
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    responsive: {
      enabled: false,
      preset: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      colorScheme: "system",
      status: "ready",
    },
    scopeId: 1,
  };
}

function info(id: string, origin: string): BrowserSiteInfo {
  return {
    tabId: id,
    origin,
    secure: true,
    profile: { id: "default", label: "default", mode: "persistent" },
    privacy: "normal",
    permissions: { camera: "ask", microphone: "ask", location: "ask", clipboard: "ask" },
    agentAccess: "user",
  };
}

describe("useBrowserSiteInfo", () => {
  afterEach(() => clearDesktopBridgeOverrideForTests());

  it("does not apply a stale site-info response after switching tabs", async () => {
    let resolveA: ((value: BrowserSiteInfo) => void) | null = null;
    let resolveB: ((value: BrowserSiteInfo) => void) | null = null;
    setDesktopBridgeOverrideForTests({
      getBrowserSiteInfo: vi.fn(
        (tabId: string) =>
          new Promise<BrowserSiteInfo>((resolve) => {
            if (tabId === "a") resolveA = resolve;
            else resolveB = resolve;
          }),
      ),
    });
    const { result, rerender } = renderHook(
      ({ activeTab }) => useBrowserSiteInfo(activeTab, true),
      { initialProps: { activeTab: tab("a", "https://a.test/page") } },
    );
    rerender({ activeTab: tab("b", "https://b.test/page") });

    act(() => resolveB?.(info("b", "https://b.test")));
    await waitFor(() => expect(result.current.info?.tabId).toBe("b"));
    act(() => resolveA?.(info("a", "https://a.test")));
    expect(result.current.info?.tabId).toBe("b");
  });

  it("keeps an explicit sharing target bound to the site that was confirmed", async () => {
    const setSharing = vi.fn(() => Promise.resolve(info("a", "https://a.test")));
    setDesktopBridgeOverrideForTests({ setBrowserAgentSharing: setSharing });
    const { result } = renderHook(() => useBrowserSiteInfo(tab("b", "https://b.test"), false));

    await act(() => result.current.setSharing({ tabId: "a", origin: "https://a.test" }, true));

    expect(setSharing).toHaveBeenCalledWith("a", "https://a.test", true);
  });

  it("cancels sharing confirmation when the active tab changes", async () => {
    const setSharing = vi.fn(() => Promise.resolve(info("a", "https://a.test")));
    setDesktopBridgeOverrideForTests({
      getBrowserSiteInfo: vi.fn((tabId) =>
        Promise.resolve(tabId === "a" ? info("a", "https://a.test") : info("b", "https://b.test")),
      ),
      setBrowserAgentSharing: setSharing,
    });
    const { rerender } = render(
      <BrowserSiteInformation
        activeTab={tab("a", "https://a.test/page")}
        onOverlayOpenChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Site information and permissions" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Share this tab with agent…" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <BrowserSiteInformation
        activeTab={tab("b", "https://b.test/page")}
        onOverlayOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setSharing).not.toHaveBeenCalled();
  });
});
