import type { BrowserWindow } from "electron";
import { BrowserDownloadManager } from "./browser-download-manager";
import { shutdownBrowserFaviconRasterizer } from "./browser-favicon-rasterizer";
import type { BrowserTabLifecycle } from "./browser-tab-lifecycle";
import { sendToWindow } from "./safe-send";

export function createBrowserDownloadManager(options: {
  lifecycle: BrowserTabLifecycle;
  getWindow: () => BrowserWindow | null;
  reportError: (message: string, scopeId: number) => void;
}): BrowserDownloadManager {
  return new BrowserDownloadManager({
    lifecycle: options.lifecycle,
    emit: (scopeId, snapshot) => {
      sendToWindow(options.getWindow(), "browser:downloads-changed", snapshot);
    },
    emitActiveCounts: (counts) =>
      sendToWindow(options.getWindow(), "browser:download-counts", counts),
    reportError: options.reportError,
  });
}

export async function prepareBrowserShutdown(
  downloads: BrowserDownloadManager,
  prepareWorkspace: () => Promise<void>,
): Promise<void> {
  try {
    await downloads.prepareForShutdown();
    await prepareWorkspace();
    shutdownBrowserFaviconRasterizer();
  } catch (error) {
    downloads.resumeAfterShutdownAbort();
    throw error;
  }
}
