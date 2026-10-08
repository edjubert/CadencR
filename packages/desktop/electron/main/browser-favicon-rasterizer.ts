import { WebContentsView, type WebContents } from "electron";

const MAX_PENDING_JOBS = 16;
const DECODER_URL =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:">',
  );

interface DecoderContents extends Pick<
  WebContents,
  "close" | "executeJavaScript" | "isDestroyed" | "loadURL" | "setWindowOpenHandler" | "session"
> {
  on(event: "will-navigate", listener: (event: Electron.Event, url: string) => void): void;
  on(event: "render-process-gone" | "destroyed", listener: () => void): void;
}

interface DecoderView {
  webContents: DecoderContents;
}

/** One sandboxed, network-denied SVG image decoder shared by all Browser tabs. */
export class BrowserFaviconRasterizer {
  private view: DecoderView | null = null;
  private ready: Promise<{ contents: DecoderContents; view: DecoderView }> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private readonly shutdownAbort = new AbortController();

  constructor(private readonly createView: () => DecoderView = createDecoderView) {}

  async rasterize(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string | null> {
    if (this.closed || signal.aborted || this.pending >= MAX_PENDING_JOBS) return null;
    const jobSignal = AbortSignal.any([signal, this.shutdownAbort.signal]);
    this.pending += 1;
    const result = this.queue.then(() => this.run(bytes, jobSignal));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } finally {
      this.pending -= 1;
    }
  }

  shutdown(): void {
    this.closed = true;
    this.shutdownAbort.abort();
    this.destroyView();
  }

  private async run(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string | null> {
    if (this.closed || signal.aborted) return null;
    try {
      const operation = this.decode(bytes, signal);
      const result = await abortDecoder(operation, signal, () => this.destroyView());
      return isSafePng(result) ? result : null;
    } catch (error) {
      this.destroyView();
      if (signal.aborted || this.closed) return null;
      throw error;
    }
  }

  private async decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<unknown> {
    const { contents, view } = await this.ensureContents();
    if (this.closed || signal.aborted || this.view !== view || contents.isDestroyed()) {
      return null;
    }
    return contents.executeJavaScript(decoderScript(bytes));
  }

  private ensureContents(): Promise<{ contents: DecoderContents; view: DecoderView }> {
    if (this.ready) return this.ready;
    const view = this.createView();
    const contents = view.webContents;
    this.view = view;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (url !== DECODER_URL) event.preventDefault();
    });
    contents.on("render-process-gone", () => this.retireView(view));
    contents.on("destroyed", () => this.retireView(view));
    contents.session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      callback({ cancel: !decoderRequestAllowed(details) });
    });
    this.ready = contents.loadURL(DECODER_URL).then(() => ({ contents, view }));
    this.ready.catch(() => this.retireView(view));
    return this.ready;
  }

  private retireView(view: DecoderView): void {
    if (this.view !== view) return;
    this.view = null;
    this.ready = null;
    closeDecoderView(view);
  }

  private destroyView(): void {
    const view = this.view;
    this.view = null;
    this.ready = null;
    if (view) closeDecoderView(view);
  }
}

function decoderRequestAllowed(details: Electron.OnBeforeRequestListenerDetails): boolean {
  return (
    (details.resourceType === "mainFrame" && details.url === DECODER_URL) ||
    (details.resourceType === "image" && details.url.startsWith("data:image/svg+xml;base64,"))
  );
}

function closeDecoderView(view: DecoderView): void {
  if (view.webContents.isDestroyed()) return;
  view.webContents.session.webRequest.onBeforeRequest(null);
  view.webContents.close({ waitForBeforeUnload: false });
}

function createDecoderView(): DecoderView {
  return new WebContentsView({
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition: "cadencr-browser-favicon-decoder",
      backgroundThrottling: false,
    },
  });
}

function decoderScript(bytes: Uint8Array<ArrayBuffer>): string {
  const source = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
  return `(() => new Promise((resolve) => {
    const image = new Image();
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      image.src = "";
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 3000);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d");
        if (!context) return finish(null);
        context.drawImage(image, 0, 0, 32, 32);
        finish(canvas.toDataURL("image/png"));
      } catch { finish(null); }
    };
    image.onerror = () => finish(null);
    image.src = ${JSON.stringify(source)};
  }))()`;
}

async function abortDecoder(
  operation: Promise<unknown>,
  signal: AbortSignal,
  destroy: () => void,
): Promise<unknown> {
  if (signal.aborted) return null;
  let abort: (() => void) | undefined;
  const aborted = new Promise<null>((resolve) => {
    abort = (): void => {
      destroy();
      resolve(null);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function isSafePng(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 * 1024 &&
    /^data:image\/png;base64,[a-z\d+/]+={0,2}$/iu.test(value)
  );
}

const sharedRasterizer = new BrowserFaviconRasterizer();

export const rasterizeBrowserFaviconSvg = (
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<string | null> => sharedRasterizer.rasterize(bytes, signal);

export const shutdownBrowserFaviconRasterizer = (): void => sharedRasterizer.shutdown();
