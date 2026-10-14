import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserDownloadManager } from "./browser-download-manager";

const shutdownBrowserFaviconRasterizer = vi.hoisted(() => vi.fn());
vi.mock("./browser-favicon-rasterizer", () => ({ shutdownBrowserFaviconRasterizer }));

import { prepareBrowserShutdown } from "./browser-manager-downloads";

describe("prepareBrowserShutdown", () => {
  beforeEach(() => shutdownBrowserFaviconRasterizer.mockClear());

  it("resumes download acceptance when workspace shutdown preparation fails", async () => {
    const prepareForShutdown = vi.fn(async () => undefined);
    const resumeAfterShutdownAbort = vi.fn();
    const downloads = {
      prepareForShutdown,
      resumeAfterShutdownAbort,
    } as unknown as BrowserDownloadManager;
    const workspaceError = new Error("workspace flush failed");

    await expect(
      prepareBrowserShutdown(downloads, async () => {
        throw workspaceError;
      }),
    ).rejects.toBe(workspaceError);

    expect(prepareForShutdown).toHaveBeenCalledOnce();
    expect(resumeAfterShutdownAbort).toHaveBeenCalledOnce();
    expect(shutdownBrowserFaviconRasterizer).not.toHaveBeenCalled();
  });

  it("shuts down the favicon decoder only after successful preparation", async () => {
    const downloads = {
      prepareForShutdown: vi.fn(async () => undefined),
      resumeAfterShutdownAbort: vi.fn(),
    } as unknown as BrowserDownloadManager;
    const prepareWorkspace = vi.fn(async () => undefined);

    await prepareBrowserShutdown(downloads, prepareWorkspace);

    expect(prepareWorkspace).toHaveBeenCalledOnce();
    expect(shutdownBrowserFaviconRasterizer).toHaveBeenCalledOnce();
  });
});
