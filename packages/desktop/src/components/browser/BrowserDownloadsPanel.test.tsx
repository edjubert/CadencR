import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import {
  clearDesktopBridgeOverrideForTests,
  desktopBridge,
  setDesktopBridgeOverrideForTests,
  type BrowserDownload,
  type BrowserDownloadSnapshot,
} from "@/lib/desktop-bridge";
import { BrowserDownloadsPanel } from "./BrowserDownloadsPanel";

afterEach(() => clearDesktopBridgeOverrideForTests());

describe("BrowserDownloadsPanel", () => {
  it("gives the virtualized list an explicit content-aware height", async () => {
    setDesktopBridgeOverrideForTests({
      ...desktopBridge,
      listBrowserDownloads: vi.fn(async () => snapshot([download()])),
      onBrowserDownloadsChanged: vi.fn(() => () => undefined),
    });

    render(<BrowserDownloadsPanel scopeId={4} open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("report.txt")).toBeInTheDocument();
    expect(screen.getByTestId("virtuoso-mock")).toHaveStyle({ height: "84px" });
  });

  it("shows an initial error and retries the list request", async () => {
    const listBrowserDownloads = vi
      .fn<() => Promise<BrowserDownloadSnapshot>>()
      .mockRejectedValueOnce(new Error("download IPC unavailable"))
      .mockResolvedValueOnce(snapshot([]));
    setDesktopBridgeOverrideForTests({
      ...desktopBridge,
      listBrowserDownloads,
      onBrowserDownloadsChanged: vi.fn(() => () => undefined),
    });

    const { user } = render(<BrowserDownloadsPanel scopeId={4} open onOpenChange={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("download IPC unavailable");
    expect(screen.getByRole("button", { name: "Downloads: No active downloads" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(listBrowserDownloads).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("No downloads yet")).toBeInTheDocument();
  });
});

function snapshot(downloads: BrowserDownload[]): BrowserDownloadSnapshot {
  return {
    scopeId: 4,
    downloads,
    activeCount: downloads.filter((entry) => entry.canCancel).length,
    aggregatePercent: downloads.length > 0 ? 50 : null,
  };
}

function download(): BrowserDownload {
  return {
    id: "download-id",
    tabId: "tab-id",
    scopeId: 4,
    filename: "report.txt",
    destination: "/Users/test/Downloads/report.txt",
    state: "progressing",
    receivedBytes: 50,
    totalBytes: 100,
    bytesPerSecond: 10,
    percent: 50,
    canPause: true,
    canResume: false,
    canCancel: true,
    private: false,
    startedAt: "2026-09-08T10:00:00.000Z",
  };
}
