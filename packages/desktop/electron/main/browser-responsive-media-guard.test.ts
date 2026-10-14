import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { createBrowserResponsiveMediaGuard } from "./browser-responsive-media-guard";

type Listener = () => void;

class FakeEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeMediaQuery extends FakeEvents {
  constructor(public matches: boolean) {
    super();
  }

  setMatches(matches: boolean): void {
    if (this.matches === matches) return;
    this.matches = matches;
    this.emit("change");
  }
}

function fixture(initialDark: boolean) {
  const page = new FakeEvents();
  const media = new FakeMediaQuery(initialDark);
  const context = createContext({
    matchMedia: () => media,
    addEventListener: page.addEventListener.bind(page),
    removeEventListener: page.removeEventListener.bind(page),
  });
  const execute = vi.fn(async (_worldId: number, scripts: Electron.WebSource[]) => {
    const source = scripts[0];
    if (!source) throw new Error("Missing isolated-world source");
    return await runInContext(source.code, context);
  });
  const webContents = {
    executeJavaScriptInIsolatedWorld: execute,
    isDestroyed: () => false,
  } as unknown as Electron.WebContents;
  return { execute, media, page, webContents };
}

describe("createBrowserResponsiveMediaGuard", () => {
  it("reports an appearance reset that happened before the guard was armed", async () => {
    const { media, webContents } = fixture(true);
    const guard = createBrowserResponsiveMediaGuard(webContents, "light", 1);

    await expect(guard.result).resolves.toEqual({ token: 1, kind: "mismatch" });
    expect(media.count("change")).toBe(0);
  });

  it("reports the first later media-query change and then removes itself", async () => {
    const { execute, media, webContents } = fixture(false);
    const guard = createBrowserResponsiveMediaGuard(webContents, "light", 2);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    media.setMatches(true);

    await expect(guard.result).resolves.toEqual({ token: 2, kind: "mismatch" });
    expect(media.count("change")).toBe(0);
  });

  it("cancels the isolated listener and settles the local waiter as stale", async () => {
    const { execute, media, webContents } = fixture(false);
    const guard = createBrowserResponsiveMediaGuard(webContents, "light", 3);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    await guard.cancel();

    await expect(guard.result).resolves.toEqual({ token: 3, kind: "stale" });
    expect(media.count("change")).toBe(0);
  });

  it("treats page teardown as a stale guard rather than a reset", async () => {
    const { execute, page, webContents } = fixture(false);
    const guard = createBrowserResponsiveMediaGuard(webContents, "light", 4);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));

    page.emit("pagehide");

    await expect(guard.result).resolves.toEqual({ token: 4, kind: "stale" });
  });

  it("surfaces current setup failures and malformed isolated-world results", async () => {
    const failed = {
      executeJavaScriptInIsolatedWorld: vi.fn(async () => {
        throw new Error("isolated world unavailable");
      }),
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;
    const malformed = {
      executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ version: 1, token: 99 })),
      isDestroyed: () => false,
    } as unknown as Electron.WebContents;

    await expect(
      createBrowserResponsiveMediaGuard(failed, "dark", 5).result,
    ).resolves.toMatchObject({
      token: 5,
      kind: "error",
      error: new Error("isolated world unavailable"),
    });
    await expect(
      createBrowserResponsiveMediaGuard(malformed, "dark", 6).result,
    ).resolves.toMatchObject({
      token: 6,
      kind: "error",
      error: new Error("Browser responsive appearance guard returned an invalid result."),
    });
  });
});
