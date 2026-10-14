import { describe, expect, it, vi } from "vitest";
import { createBrowserProfile } from "./browser-profiles";
import { BrowserSessionLifecycle } from "./browser-session-lifecycle";

describe("BrowserSessionLifecycle", () => {
  it("clears a private partition only after its final tab owner closes", async () => {
    const clear = vi.fn(async () => undefined);
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("fresh", "private-session");
    lifecycle.claim(profile);
    lifecycle.claim(profile);

    await lifecycle.release(profile);
    expect(clear).not.toHaveBeenCalled();

    await lifecycle.release(profile);
    expect(clear).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith("browser:fresh:private-session");
  });

  it("keeps a private partition alive while an independent download lease exists", async () => {
    const clear = vi.fn(async () => undefined);
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("fresh", "private-session");
    lifecycle.claim(profile);
    const releaseDownload = lifecycle.acquire(profile);

    await lifecycle.release(profile);
    expect(clear).not.toHaveBeenCalled();

    await releaseDownload();
    await releaseDownload();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("never clears a persistent profile when its last tab closes", async () => {
    const clear = vi.fn(async () => undefined);
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("persistent", "default");

    lifecycle.claim(profile);
    await lifecycle.release(profile);

    expect(clear).not.toHaveBeenCalled();
  });

  it("does not change the existing feature-profile lifecycle", async () => {
    const clear = vi.fn(async () => undefined);
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("feature", "feature");

    lifecycle.claim(profile);
    await lifecycle.release(profile);

    expect(clear).not.toHaveBeenCalled();
  });

  it("blocks a partition while its final-owner cleanup is pending", async () => {
    let finishCleanup: (() => void) | undefined;
    const clear = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("fresh", "private-session");
    lifecycle.claim(profile);

    const release = lifecycle.release(profile);
    expect(() => lifecycle.claim(profile)).toThrow("unavailable while it is being cleared");
    await Promise.resolve();
    finishCleanup?.();
    await release;

    expect(() => lifecycle.claim(profile)).not.toThrow();
  });

  it("keeps a partition unavailable when cleanup fails", async () => {
    const clear = vi.fn(async () => {
      throw new Error("disk failure");
    });
    const lifecycle = new BrowserSessionLifecycle(clear);
    const profile = createBrowserProfile("fresh", "private-session");
    lifecycle.claim(profile);

    await expect(lifecycle.release(profile)).rejects.toThrow(
      "Could not clear private browser session",
    );
    expect(() => lifecycle.claim(profile)).toThrow("unavailable while it is being cleared");
  });
});
