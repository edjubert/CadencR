import {
  cloneBrowserResponsiveState,
  isValidBrowserResponsiveState,
  responsiveStateFromRequest,
} from "../../src/shared/browser-responsive";
import type { ManagedTab } from "./browser-tab-events";
import type {
  BrowserResponsiveRequest,
  BrowserResponsiveState,
  BrowserTabMetadata,
} from "./browser-types";
import {
  applyResponsiveOverrides,
  applyResponsiveProtocolOverrides,
  clearResponsiveOverrides,
} from "./browser-responsive-emulation";
import { BrowserResponsiveMediaGuardCoordinator } from "./browser-responsive-media-guard";

interface ResponsiveRuntime {
  revision: number;
  geometryRevision: number;
  queue: Promise<void>;
  desiredScale: number;
  appliedScale: number;
  destroyed: boolean;
  refreshQueued: boolean;
  recoveryQueued: boolean;
  inputRevision: number;
  pendingNativeOperations: number;
}

interface BrowserResponsiveHost {
  applyLayout(): void;
  emitState(scopeId: number | null): void;
  reportError(error: unknown, scopeId: number | null): void;
  nativeScale(tab: ManagedTab, request: BrowserResponsiveRequest): number;
}

/** Owns per-tab Chromium emulation while preserving the tab's WebContents/session. */
export class BrowserResponsiveController {
  private readonly runtimes = new WeakMap<ManagedTab, ResponsiveRuntime>();
  private readonly mediaGuards: BrowserResponsiveMediaGuardCoordinator;

  constructor(private readonly host: BrowserResponsiveHost) {
    this.mediaGuards = new BrowserResponsiveMediaGuardCoordinator({
      refresh: (tab) => this.scheduleRefresh(tab, "DevTools reset responsive appearance"),
      reportError: (error, scopeId) => this.host.reportError(error, scopeId),
    });
  }

  watch(tab: ManagedTab): void {
    const runtime = this.runtime(tab);
    tab.webContents.on("devtools-opened", () =>
      this.scheduleRefresh(tab, "DevTools reset responsive overrides"),
    );
    tab.webContents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) this.mediaGuards.cancel(tab);
    });
    tab.webContents.debugger.on("detach", () => this.scheduleDebuggerRecovery(tab));
    tab.webContents.once("destroyed", () => {
      this.mediaGuards.cancel(tab);
      runtime.destroyed = true;
      runtime.revision += 1;
    });
  }

  /** Custom DevTools WebContents do not reliably emit `devtools-opened` on their guest. */
  devToolsLoaded(tab: ManagedTab): void {
    this.scheduleRefresh(tab, "DevTools reset responsive overrides");
    this.mediaGuards.loaded(tab, this.runtime(tab).queue);
  }

  async set(tab: ManagedTab, request: BrowserResponsiveRequest): Promise<BrowserTabMetadata> {
    assertResponsiveRequest(request);
    this.mediaGuards.reconfigure(tab, request);
    const runtime = this.runtime(tab);
    runtime.desiredScale = validScale(this.host.nativeScale(tab, request));
    const revision = ++runtime.revision;
    this.beginNativeOperation(runtime);
    const next = responsiveStateFromRequest(request);
    try {
      await this.enqueue(runtime, async () => {
        if (!this.isCurrent(tab, runtime, revision)) return;
        const previous = cloneBrowserResponsiveState(tab.metadata.responsive);
        let applied: { scale: number; settled: boolean } | null = null;
        try {
          applied = await this.applyStable(tab, runtime, next, revision);
          if (!applied) return;
          runtime.appliedScale = applied.scale;
        } catch (error) {
          if (!this.isCurrent(tab, runtime, revision)) return;
          const failure = await this.recoverAfterSetFailure(
            tab,
            runtime,
            revision,
            previous,
            error,
          );
          if (failure) throw failure;
          return;
        }
        if (!this.isCurrent(tab, runtime, revision)) return;
        tab.metadata = { ...tab.metadata, responsive: next };
        this.host.applyLayout();
        this.host.emitState(tab.metadata.scopeId);
        this.mediaGuards.applied(tab);
        if (!applied.settled || !approximatelyEqual(runtime.appliedScale, runtime.desiredScale)) {
          this.scheduleRefresh(tab, "Responsive viewport could not follow the Browser size");
        }
      });
    } finally {
      this.finishNativeOperation(runtime);
    }
    return tab.metadata;
  }

  /** Coalesces native layout changes; every actual mutation stays on the tab queue. */
  syncScale(tab: ManagedTab, nativeScale: number): void {
    const runtime = this.runtime(tab);
    const nextScale = validScale(nativeScale);
    if (!approximatelyEqual(runtime.desiredScale, nextScale)) {
      runtime.desiredScale = nextScale;
      runtime.geometryRevision += 1;
      runtime.inputRevision += 1;
    }
    if (!approximatelyEqual(runtime.appliedScale, nextScale)) {
      this.scheduleRefresh(tab, "Responsive viewport could not follow the Browser size");
    }
  }

  /** Browser zoom is origin-scoped, so every live tab is resynchronized by the zoom controller. */
  syncZoom(tab: ManagedTab): void {
    const runtime = this.runtime(tab);
    runtime.geometryRevision += 1;
    runtime.inputRevision += 1;
    this.scheduleRefresh(tab, "Responsive viewport could not preserve page zoom");
  }

  inputScaleGuard(tab: ManagedTab): () => number {
    const runtime = this.runtime(tab);
    const revision = runtime.inputRevision;
    return () => {
      if (
        runtime.inputRevision !== revision ||
        runtime.destroyed ||
        runtime.pendingNativeOperations > 0 ||
        tab.metadata.responsive.status === "error"
      ) {
        throw new Error("Browser viewport changed before input could be dispatched. Try again.");
      }
      return this.inputScale(tab);
    };
  }

  private inputScale(tab: ManagedTab): number {
    const responsive = tab.metadata.responsive;
    return responsive.enabled && responsive.status === "ready" ? this.runtime(tab).appliedScale : 1;
  }

  private runtime(tab: ManagedTab): ResponsiveRuntime {
    const existing = this.runtimes.get(tab);
    if (existing) return existing;
    const created: ResponsiveRuntime = {
      revision: 0,
      geometryRevision: 0,
      queue: Promise.resolve(),
      desiredScale: 1,
      appliedScale: 1,
      destroyed: false,
      refreshQueued: false,
      recoveryQueued: false,
      inputRevision: 0,
      pendingNativeOperations: 0,
    };
    this.runtimes.set(tab, created);
    return created;
  }

  private enqueue(runtime: ResponsiveRuntime, operation: () => Promise<void>): Promise<void> {
    const result = runtime.queue.then(operation);
    runtime.queue = result.catch(() => undefined);
    return result;
  }

  private scheduleRefresh(tab: ManagedTab, context: string): void {
    const runtime = this.runtime(tab);
    if (!tab.metadata.responsive.enabled || runtime.destroyed || runtime.refreshQueued) return;
    runtime.refreshQueued = true;
    this.beginNativeOperation(runtime);
    const revision = runtime.revision;
    const refresh = this.enqueue(runtime, async () => {
      runtime.refreshQueued = false;
      if (!this.isCurrent(tab, runtime, revision)) return;
      try {
        const applied = await this.applyStable(tab, runtime, tab.metadata.responsive, revision);
        if (!applied) return;
        runtime.appliedScale = applied.scale;
        if (!applied.settled) {
          this.scheduleRefresh(tab, "Responsive viewport could not follow the Browser size");
        }
      } catch (error) {
        if (!this.isCurrent(tab, runtime, revision)) return;
        await this.failClosed(tab, runtime, error, context);
      }
    });
    this.observeBackground(tab, runtime, refresh);
  }

  private scheduleDebuggerRecovery(tab: ManagedTab): void {
    const runtime = this.runtime(tab);
    if (!tab.metadata.responsive.enabled || runtime.destroyed || runtime.recoveryQueued) return;
    runtime.recoveryQueued = true;
    this.beginNativeOperation(runtime);
    const revision = runtime.revision;
    const recovery = this.enqueue(runtime, async () => {
      try {
        if (!this.isCurrent(tab, runtime, revision)) return;
        if (!tab.metadata.responsive.enabled) return;
        await applyResponsiveProtocolOverrides(
          tab.webContents,
          tab.metadata.responsive,
          runtime.desiredScale,
        );
      } catch (error) {
        if (!this.isCurrent(tab, runtime, revision)) return;
        await this.failClosed(
          tab,
          runtime,
          error,
          "Responsive touch and appearance were interrupted",
        );
      } finally {
        runtime.recoveryQueued = false;
      }
    });
    this.observeBackground(tab, runtime, recovery);
  }

  private async recoverAfterSetFailure(
    tab: ManagedTab,
    runtime: ResponsiveRuntime,
    revision: number,
    previous: BrowserResponsiveState,
    originalError: unknown,
  ): Promise<Error | null> {
    try {
      runtime.desiredScale = validScale(this.host.nativeScale(tab, previous));
      runtime.geometryRevision += 1;
      runtime.inputRevision += 1;
      const restored = await this.applyStable(tab, runtime, previous, revision);
      if (!restored) return null;
      runtime.appliedScale = restored.scale;
      this.host.applyLayout();
      if (!restored.settled) {
        this.scheduleRefresh(tab, "The restored responsive viewport is still settling");
      }
      return responsiveSetError(originalError, "The previous settings were restored.");
    } catch (restoreError) {
      if (!this.isCurrent(tab, runtime, revision)) return null;
      const cleanupError = await clearResponsiveOverrides(tab.webContents);
      if (!this.isCurrent(tab, runtime, revision)) return null;
      const errors = [originalError, restoreError];
      if (cleanupError) errors.push(cleanupError);
      const failed = new AggregateError(errors, "Responsive update and rollback failed.");
      if (!runtime.destroyed && !tab.webContents.isDestroyed()) {
        tab.metadata = {
          ...tab.metadata,
          responsive: cleanupError
            ? { ...previous, status: "error" }
            : { ...previous, enabled: false, status: "ready" },
        };
        this.host.applyLayout();
        this.host.reportError(failed, tab.metadata.scopeId);
      }
      return failed;
    }
  }

  private async applyStable(
    tab: ManagedTab,
    runtime: ResponsiveRuntime,
    state: BrowserResponsiveState,
    revision: number,
  ): Promise<{ scale: number; settled: boolean } | null> {
    let appliedScale = runtime.appliedScale;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.isCurrent(tab, runtime, revision)) return null;
      const geometryRevision = runtime.geometryRevision;
      const scale = runtime.desiredScale;
      await applyResponsiveOverrides(tab.webContents, state, scale);
      appliedScale = scale;
      if (!this.isCurrent(tab, runtime, revision)) return null;
      if (
        geometryRevision === runtime.geometryRevision &&
        approximatelyEqual(scale, runtime.desiredScale)
      ) {
        return { scale, settled: true };
      }
    }
    return { scale: appliedScale, settled: false };
  }

  private async failClosed(
    tab: ManagedTab,
    runtime: ResponsiveRuntime,
    error: unknown,
    context: string,
  ): Promise<void> {
    if (runtime.destroyed || tab.webContents.isDestroyed()) return;
    this.mediaGuards.cancel(tab);
    const revision = ++runtime.revision;
    runtime.inputRevision += 1;
    const cleanupError = await clearResponsiveOverrides(tab.webContents);
    if (!this.isCurrent(tab, runtime, revision)) return;
    const failure = cleanupError
      ? new AggregateError([error, cleanupError], `${context}; cleanup also failed.`)
      : new Error(`${context}: ${errorMessage(error)}`);
    tab.metadata = {
      ...tab.metadata,
      responsive: cleanupError
        ? { ...tab.metadata.responsive, status: "error" }
        : { ...tab.metadata.responsive, enabled: false, status: "ready" },
    };
    this.host.applyLayout();
    this.host.reportError(failure, tab.metadata.scopeId);
  }

  private isCurrent(tab: ManagedTab, runtime: ResponsiveRuntime, revision: number): boolean {
    return !runtime.destroyed && !tab.webContents.isDestroyed() && runtime.revision === revision;
  }

  private beginNativeOperation(runtime: ResponsiveRuntime): void {
    runtime.pendingNativeOperations += 1;
    runtime.inputRevision += 1;
  }

  private finishNativeOperation(runtime: ResponsiveRuntime): void {
    runtime.pendingNativeOperations = Math.max(0, runtime.pendingNativeOperations - 1);
    runtime.inputRevision += 1;
  }

  private observeBackground(
    tab: ManagedTab,
    runtime: ResponsiveRuntime,
    operation: Promise<void>,
  ): void {
    void operation
      .finally(() => this.finishNativeOperation(runtime))
      .catch((error: unknown) => {
        if (!runtime.destroyed && !tab.webContents.isDestroyed()) {
          this.host.reportError(error, tab.metadata.scopeId);
        }
      });
  }
}

function assertResponsiveRequest(request: BrowserResponsiveRequest): void {
  if (!isValidBrowserResponsiveState(request)) {
    throw new Error("Invalid Browser responsive viewport configuration.");
  }
}

function validScale(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000_1;
}

function responsiveSetError(error: unknown, outcome: string): Error {
  return new Error(`Could not update responsive mode. ${outcome} ${errorMessage(error)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
