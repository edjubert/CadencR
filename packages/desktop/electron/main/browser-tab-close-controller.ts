import type { BrowserScopeState } from "./browser-scope-state";
import { settleBrowserSessionCleanups } from "./browser-session-lifecycle";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserTabLifecycle } from "./browser-tab-lifecycle";

interface BrowserTabCloseHost {
  emitCounts(): void;
  activate(tabId: string): void;
  applyLayout(): void;
  emitState(scope: number | null): void;
  reportError(error: unknown, scope: number | null): void;
  invalidateFind(tab: ManagedTab): void;
}

/** Coordinates tab removal and asynchronous session teardown. */
export class BrowserTabCloseController {
  constructor(
    private readonly tabs: Map<string, ManagedTab>,
    private readonly scopes: BrowserScopeState,
    private readonly lifecycle: BrowserTabLifecycle,
    private readonly host: BrowserTabCloseHost,
  ) {}

  async close(tab: ManagedTab, activateFallback = true): Promise<void> {
    this.host.invalidateFind(tab);
    const cleanup = this.lifecycle.destroy(tab);
    this.afterRemoval(tab, activateFallback);
    await this.finish(cleanup, tab.metadata.scopeId);
  }

  async closeScope(scopeId: number): Promise<void> {
    const tabs = [...this.tabs.values()].filter((tab) => tab.metadata.scopeId === scopeId);
    await this.closeMany(tabs, scopeId);
  }

  async closeMany(tabs: ManagedTab[], scopeId: number | null): Promise<void> {
    const cleanups = tabs.map((tab) => {
      this.host.invalidateFind(tab);
      const cleanup = this.lifecycle.destroy(tab);
      this.scopes.forget(tab.metadata.scopeId, tab.metadata.id, this.tabs);
      return cleanup;
    });
    this.host.emitCounts();
    this.refresh(scopeId);
    await this.finish(settleBrowserSessionCleanups(cleanups), scopeId);
  }

  discardFailed(tab: ManagedTab, setupError: unknown): void {
    this.host.reportError(setupError, tab.metadata.scopeId);
    this.host.invalidateFind(tab);
    const cleanup = this.lifecycle.destroy(tab);
    this.afterRemoval(tab);
    this.finishInBackground(cleanup, tab.metadata.scopeId, "setup failure");
  }

  handleNativeDestroyed(tab: ManagedTab): void {
    if (!this.tabs.has(tab.metadata.id)) return;
    const cleanup = this.lifecycle.destroy(tab);
    this.afterRemoval(tab);
    this.finishInBackground(cleanup, tab.metadata.scopeId, "native destruction");
  }

  private afterRemoval(tab: ManagedTab, activateFallback = true): void {
    const scope = tab.metadata.scopeId;
    this.host.emitCounts();
    const next = this.scopes.forget(scope, tab.metadata.id, this.tabs);
    if (next && activateFallback) {
      this.host.activate(next);
      return;
    }
    this.refresh(scope);
  }

  private refresh(scope: number | null): void {
    this.scopes.refreshActiveFlags(this.tabs);
    this.host.applyLayout();
    this.host.emitState(scope);
  }

  private async finish(cleanup: Promise<void>, scope: number | null): Promise<void> {
    try {
      await cleanup;
    } catch (error) {
      this.host.reportError(error, scope);
      throw error;
    }
  }

  private finishInBackground(cleanup: Promise<void>, scope: number | null, context: string): void {
    void this.finish(cleanup, scope).catch((error: unknown) => {
      console.error(`Browser tab cleanup after ${context} failed:`, error);
    });
  }
}
