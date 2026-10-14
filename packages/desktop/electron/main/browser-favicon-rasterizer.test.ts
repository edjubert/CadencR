import { describe, expect, it, vi } from "vitest";
import { BrowserFaviconRasterizer } from "./browser-favicon-rasterizer";

function decoder(
  executeJavaScript = vi.fn<(code: string) => Promise<string>>(async () =>
    Promise.resolve("data:image/png;base64,iVBORw=="),
  ),
  loadURL = vi.fn<(url: string) => Promise<void>>(async () => Promise.resolve()),
) {
  const listeners = new Map<string, () => void>();
  const onBeforeRequest = vi.fn();
  const contents = {
    close: vi.fn(),
    executeJavaScript,
    isDestroyed: vi.fn(() => false),
    loadURL,
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    setWindowOpenHandler: vi.fn(),
    session: { webRequest: { onBeforeRequest } },
  };
  return { contents, listeners, onBeforeRequest, view: { webContents: contents } };
}

describe("BrowserFaviconRasterizer", () => {
  it.each([
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64," + "a".repeat(256 * 1024),
    "data:image/png;base64,invalid!",
  ])("rejects unsafe decoder output (%#)", async (output) => {
    const mock = decoder(vi.fn(async () => output));
    const rasterizer = new BrowserFaviconRasterizer(() => mock.view as never);
    await expect(
      rasterizer.rasterize(new Uint8Array([1]), new AbortController().signal),
    ).resolves.toBeNull();
    rasterizer.shutdown();
  });

  it("does not create a decoder for already-aborted work", async () => {
    const createView = vi.fn();
    const rasterizer = new BrowserFaviconRasterizer(createView);
    await expect(
      rasterizer.rasterize(new Uint8Array([1]), AbortSignal.abort()),
    ).resolves.toBeNull();
    expect(createView).not.toHaveBeenCalled();
  });

  it("bounds queued jobs and creates a new decoder after a crash", async () => {
    const first = decoder(
      undefined,
      vi.fn(() => new Promise(() => undefined)),
    );
    const second = decoder();
    const createView = vi.fn().mockReturnValueOnce(first.view).mockReturnValue(second.view);
    const rasterizer = new BrowserFaviconRasterizer(createView);
    const controller = new AbortController();
    const pending = Array.from({ length: 16 }, () =>
      rasterizer.rasterize(new Uint8Array([1]), controller.signal),
    );
    await expect(
      rasterizer.rasterize(new Uint8Array([2]), new AbortController().signal),
    ).resolves.toBeNull();
    await vi.waitFor(() => expect(first.contents.loadURL).toHaveBeenCalledOnce());
    first.listeners.get("render-process-gone")?.();
    controller.abort();
    await Promise.all(pending);
    await expect(
      rasterizer.rasterize(new Uint8Array([3]), new AbortController().signal),
    ).resolves.toMatch(/^data:image\/png/);
    expect(createView).toHaveBeenCalledTimes(2);
    rasterizer.shutdown();
  });

  it("reuses one sandbox decoder and returns only PNG data", async () => {
    const mock = decoder();
    const createView = vi.fn(() => mock.view as never);
    const rasterizer = new BrowserFaviconRasterizer(createView);
    const signal = new AbortController().signal;

    await expect(rasterizer.rasterize(new Uint8Array([1]), signal)).resolves.toMatch(
      /^data:image\/png/,
    );
    await rasterizer.rasterize(new Uint8Array([2]), signal);
    expect(createView).toHaveBeenCalledOnce();
    expect(mock.contents.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(mock.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ["<all_urls>"] },
      expect.any(Function),
    );
    const guard = mock.onBeforeRequest.mock.calls[0]?.[1] as (
      details: { resourceType: string; url: string },
      callback: (result: { cancel: boolean }) => void,
    ) => void;
    const allowed = vi.fn();
    guard({ resourceType: "mainFrame", url: mock.contents.loadURL.mock.calls[0]![0] }, allowed);
    expect(allowed).toHaveBeenCalledWith({ cancel: false });
    const denied = vi.fn();
    guard({ resourceType: "image", url: "https://attacker.example/pixel" }, denied);
    expect(denied).toHaveBeenCalledWith({ cancel: true });
  });

  it("destroys a hung decoder when the job is aborted", async () => {
    const mock = decoder(vi.fn(() => new Promise(() => undefined)));
    const rasterizer = new BrowserFaviconRasterizer(() => mock.view as never);
    const controller = new AbortController();
    const result = rasterizer.rasterize(new Uint8Array([1]), controller.signal);
    await vi.waitFor(() => expect(mock.contents.executeJavaScript).toHaveBeenCalledOnce());
    controller.abort();

    await expect(result).resolves.toBeNull();
    expect(mock.contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  });

  it("propagates unexpected decoder failures after cleanup", async () => {
    const mock = decoder(vi.fn(async () => Promise.reject(new Error("decoder crashed"))));
    const rasterizer = new BrowserFaviconRasterizer(() => mock.view as never);

    await expect(
      rasterizer.rasterize(new Uint8Array([1]), new AbortController().signal),
    ).rejects.toThrow("decoder crashed");
    expect(mock.contents.close).toHaveBeenCalledOnce();
  });

  it("aborts a hung initial load and cancels queued jobs on shutdown", async () => {
    const loadURL = vi.fn<(url: string) => Promise<void>>(() => new Promise(() => undefined));
    const mock = decoder(undefined, loadURL);
    const createView = vi.fn(() => mock.view as never);
    const rasterizer = new BrowserFaviconRasterizer(createView);
    const signal = new AbortController().signal;
    const first = rasterizer.rasterize(new Uint8Array([1]), signal);
    const queued = rasterizer.rasterize(new Uint8Array([2]), signal);
    await vi.waitFor(() => expect(loadURL).toHaveBeenCalledOnce());

    rasterizer.shutdown();

    await expect(first).resolves.toBeNull();
    await expect(queued).resolves.toBeNull();
    expect(mock.contents.executeJavaScript).not.toHaveBeenCalled();
    expect(mock.contents.close).toHaveBeenCalledOnce();
    await expect(rasterizer.rasterize(new Uint8Array([3]), signal)).resolves.toBeNull();
    expect(createView).toHaveBeenCalledOnce();
  });
});
