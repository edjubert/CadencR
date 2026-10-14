import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => tmpdir()) },
  shell: { showItemInFolder: vi.fn() },
}));

const { BrowserDownloadManager } = await import("./browser-download-manager");
type BrowserTabLifecycle = import("./browser-tab-lifecycle").BrowserTabLifecycle;
type ManagedTab = import("./browser-tab-events").ManagedTab;

const roots: string[] = [];

class FakeSession extends EventEmitter {}

class FakeWebContents extends EventEmitter {
  destroyed = false;

  constructor(
    readonly id: number,
    readonly session: FakeSession,
  ) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeDownloadItem extends EventEmitter {
  filename = "report.txt";
  savePath = "";
  received = 0;
  total = 1_000;
  paused = false;
  resumable = true;
  getterError: Error | null = null;
  readonly setSavePath = vi.fn((destination: string) => {
    this.savePath = destination;
  });

  getFilename(): string {
    return this.filename;
  }
  getReceivedBytes(): number {
    if (this.getterError) throw this.getterError;
    return this.received;
  }
  getTotalBytes(): number {
    if (this.getterError) throw this.getterError;
    return this.total;
  }
  getCurrentBytesPerSecond(): number {
    return 400;
  }
  getStartTime(): number {
    return 1_700_000_000;
  }
  canResume(): boolean {
    return this.resumable;
  }
  isPaused(): boolean {
    return this.paused;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  readonly cancel = vi.fn((): void => {
    this.emit("done", {}, "cancelled");
  });
  progress(state: "progressing" | "interrupted" = "progressing"): void {
    this.emit("updated", {}, state);
  }
  done(state: "completed" | "cancelled" | "interrupted"): void {
    this.emit("done", {}, state);
  }
}

function testDirectory(): string {
  const root = path.join(tmpdir(), `cadencr-download-manager-${process.pid}-${roots.length}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function tab(
  id: string,
  scopeId: number | null,
  webContents: FakeWebContents,
  privateMode = false,
): ManagedTab {
  return {
    metadata: { id, scopeId },
    profile: {
      id: privateMode ? `private-${scopeId}` : "default",
      label: privateMode ? "Private" : "Default",
      mode: privateMode ? "fresh" : "persistent",
    },
    webContents,
  } as unknown as ManagedTab;
}

function setup(
  now = 1_800_000_000_000,
  reveal = vi.fn(),
): {
  manager: InstanceType<typeof BrowserDownloadManager>;
  emit: ReturnType<typeof vi.fn>;
  emitActiveCounts: ReturnType<typeof vi.fn>;
  reportError: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  lifecycle: BrowserTabLifecycle;
  directory: string;
  setNow: (value: number) => void;
} {
  let clock = now;
  const emit = vi.fn();
  const emitActiveCounts = vi.fn();
  const reportError = vi.fn();
  const release = vi.fn(async () => undefined);
  const lifecycle = {
    acquireSessionLease: vi.fn(() => release),
  } as unknown as BrowserTabLifecycle;
  const directory = testDirectory();
  const manager = new BrowserDownloadManager({
    lifecycle,
    emit,
    emitActiveCounts,
    reportError,
    getDownloadsDirectory: () => directory,
    reveal,
    now: () => clock,
  });
  return {
    manager,
    emit,
    emitActiveCounts,
    reportError,
    release,
    lifecycle,
    directory,
    setNow: (value) => (clock = value),
  };
}

function start(
  session: FakeSession,
  webContents: FakeWebContents,
  item = new FakeDownloadItem(),
): { item: FakeDownloadItem; preventDefault: ReturnType<typeof vi.fn> } {
  const preventDefault = vi.fn();
  session.emit("will-download", { preventDefault }, item, webContents);
  return { item, preventDefault };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("BrowserDownloadManager", () => {
  it("installs one session listener and fails closed for unknown or scopeless sources", () => {
    const { manager } = setup();
    const session = new FakeSession();
    const first = new FakeWebContents(1, session);
    const second = new FakeWebContents(2, session);
    manager.watch(tab("one", 1, first));
    manager.watch(tab("two", 1, second));

    expect(session.listenerCount("will-download")).toBe(1);
    expect(start(session, new FakeWebContents(99, session)).preventDefault).toHaveBeenCalledOnce();

    const scopelessSession = new FakeSession();
    const scopeless = new FakeWebContents(3, scopelessSession);
    manager.watch(tab("agent", null, scopeless));
    expect(start(scopelessSession, scopeless).preventDefault).toHaveBeenCalledOnce();
  });

  it("reserves a collision-free path synchronously and shows its actual basename", () => {
    const { manager, directory } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 4, contents));
    writeFileSync(path.join(directory, "report.txt"), "existing");

    const { item, preventDefault } = start(session, contents);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(item.setSavePath).toHaveBeenCalledOnce();
    expect(path.basename(item.savePath)).toBe("report (1).txt");
    expect(manager.list(4).downloads[0]).toMatchObject({
      filename: "report (1).txt",
      destination: item.savePath,
      state: "progressing",
    });
  });

  it("coalesces progress, exposes pause/resume, and treats unknown totals as indeterminate", () => {
    const { manager, emit, setNow } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 4, contents));
    const item = new FakeDownloadItem();
    item.total = 0;
    start(session, contents, item);
    const id = manager.list(4).downloads[0].id;
    emit.mockClear();

    item.received = 900_000;
    item.progress();
    expect(emit).not.toHaveBeenCalled();
    setNow(1_800_000_000_100);
    item.progress();
    expect(emit).toHaveBeenCalledOnce();
    expect(manager.list(4).aggregatePercent).toBeNull();

    manager.pause(4, id);
    expect(manager.list(4).downloads[0]).toMatchObject({ state: "paused", canResume: true });
    manager.resume(4, id);
    expect(manager.list(4).downloads[0]).toMatchObject({ state: "progressing" });
  });

  it("publishes activity counts only when the active count changes", async () => {
    const { manager, emitActiveCounts, setNow } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 4, contents));
    const { item } = start(session, contents);
    expect(emitActiveCounts).toHaveBeenLastCalledWith({ 4: 1 });
    emitActiveCounts.mockClear();

    setNow(1_800_000_000_100);
    item.progress();
    expect(emitActiveCounts).not.toHaveBeenCalled();

    item.done("completed");
    await vi.waitFor(() => expect(emitActiveCounts).toHaveBeenCalledWith({}));
    expect(emitActiveCounts).toHaveBeenCalledOnce();
  });

  it("keeps ownership when publishers fail and retries active counts", () => {
    const { manager, emit, emitActiveCounts, reportError, setNow } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    emit.mockImplementation(() => {
      throw new Error("snapshot transport failed");
    });
    emitActiveCounts.mockImplementation(() => {
      throw new Error("count transport failed");
    });
    reportError.mockImplementation(() => {
      throw new Error("reporter failed");
    });
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 4, contents));

    const { item, preventDefault } = start(session, contents);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(manager.list(4).downloads).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(2);

    emit.mockReset();
    emitActiveCounts.mockReset();
    reportError.mockReset();
    setNow(1_800_000_000_100);
    item.progress();
    expect(emitActiveCounts).toHaveBeenCalledWith({ 4: 1 });
    log.mockRestore();
  });

  it("keeps unsettled terminal records inside the active capacity limit", async () => {
    const { manager, release } = setup();
    release.mockImplementation(() => new Promise<void>(() => undefined));
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 6, contents, true));
    for (let index = 0; index < 10; index += 1) {
      const { item } = start(session, contents);
      item.done("completed");
    }
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(10));

    expect(start(session, contents).preventDefault).toHaveBeenCalledOnce();
    expect(manager.list(6).downloads).toHaveLength(11);
    expect(manager.list(6).downloads[0].error).toContain("Too many active downloads");
  });

  it("keeps a private download alive after its tab closes, then releases its lease", async () => {
    const { manager, release } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("private", 7, contents, true));
    const { item } = start(session, contents);
    contents.destroy();

    item.done("completed");
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(manager.list(7).downloads[0]).toMatchObject({ state: "completed", private: true });
    expect(start(session, contents).preventDefault).toHaveBeenCalledOnce();
  });

  it("cancels the native item before finalizing an updated-event getter failure", async () => {
    const { manager, release, setNow } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 12, contents, true));
    const { item } = start(session, contents);
    item.getterError = new Error("native update failed");
    setNow(1_800_000_000_100);

    item.progress();

    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(item.cancel).toHaveBeenCalledOnce();
    expect(manager.list(12).downloads[0]).toMatchObject({
      state: "failed",
      canCancel: false,
      error: "native update failed",
    });
  });

  it("settles and releases even when native getters fail during completion", async () => {
    const { manager, release } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 8, contents, true));
    const { item } = start(session, contents);
    item.getterError = new Error("native item expired");

    item.done("completed");
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(manager.list(8).downloads[0]).toMatchObject({
      state: "completed",
      canCancel: false,
      error: "native item expired",
    });
    expect(() => item.progress()).not.toThrow();
  });

  it("enforces scope ownership and reveals only an existing completed file", async () => {
    const reveal = vi.fn();
    const { manager, directory } = setup(1_800_000_000_000, reveal);
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("one", 9, contents));
    const { item } = start(session, contents);
    item.done("completed");
    await vi.waitFor(() => expect(manager.list(9).downloads[0].state).toBe("completed"));
    const id = manager.list(9).downloads[0].id;

    expect(() => manager.reveal(10, id)).toThrow("no longer available");
    manager.reveal(9, id);
    expect(reveal).toHaveBeenCalledWith(item.savePath);
    rmSync(path.join(directory, path.basename(item.savePath)));
    expect(() => manager.reveal(9, id)).toThrow("no longer at its saved destination");
  });

  it("cancels scoped activity and clears its private in-memory history", async () => {
    const { manager } = setup();
    const session = new FakeSession();
    const contents = new FakeWebContents(1, session);
    manager.watch(tab("private", 11, contents, true));
    start(session, contents);

    const teardown = vi.fn(async () => "closed");
    await expect(manager.closeScope(11, teardown)).resolves.toBe("closed");

    expect(manager.list(11).downloads).toEqual([]);
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("rejects cancellation when a native record cannot settle its lease", async () => {
    vi.useFakeTimers();
    try {
      const { manager, release } = setup();
      release.mockImplementation(() => new Promise<void>(() => undefined));
      const session = new FakeSession();
      const contents = new FakeWebContents(1, session);
      manager.watch(tab("private", 14, contents, true));
      start(session, contents);
      const id = manager.list(14).downloads[0].id;

      const cancellation = manager.cancel(14, id);
      const expectation = expect(cancellation).rejects.toThrow(
        "Timed out settling 1 Browser download",
      );
      await vi.advanceTimersByTimeAsync(4_000);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
