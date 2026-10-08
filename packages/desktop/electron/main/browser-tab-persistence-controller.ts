import type { BrowserTabSessionStore, RestorableBrowserScope } from "./browser-tab-session-store";

const SAVE_DELAY_MS = 120;

/** Coalesces meaningful tab-session changes and serializes them through the atomic store. */
export class BrowserTabPersistenceController {
  private frozen = false;
  private readonly restorePromises = new Map<number, Promise<RestorableBrowserScope | null>>();
  private readonly enabledScopes = new Set<number>();
  private readonly disabledScopes = new Set<number>();
  private readonly pendingSaves = new Map<number, RestorableBrowserScope | null>();
  private readonly saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly outstandingWrites = new Set<Promise<void>>();
  private readonly writeFailures = new Map<number, unknown>();

  constructor(
    private readonly store: BrowserTabSessionStore,
    private readonly reportError: (message: string, scopeId: number) => void,
  ) {}

  restoreScope(scopeId: number): Promise<RestorableBrowserScope | null> {
    const current = this.restorePromises.get(scopeId);
    if (current) return current;
    const restoring = this.store
      .loadScope(scopeId)
      .then((scope) => {
        this.enabledScopes.add(scopeId);
        return scope;
      })
      .catch((error: unknown) => {
        this.disabledScopes.add(scopeId);
        this.reportError(errorMessage(error), scopeId);
        return null;
      });
    this.restorePromises.set(scopeId, restoring);
    return restoring;
  }

  isEnabled(scopeId: number): boolean {
    return this.enabledScopes.has(scopeId) && !this.disabledScopes.has(scopeId);
  }

  schedule(scopeId: number, data: RestorableBrowserScope | null): void {
    if (this.frozen || !this.isEnabled(scopeId)) return;
    this.pendingSaves.set(scopeId, data);
    const current = this.saveTimers.get(scopeId);
    if (current) clearTimeout(current);
    this.saveTimers.set(
      scopeId,
      setTimeout(() => this.startPendingSave(scopeId), SAVE_DELAY_MS),
    );
  }

  async flush(): Promise<void> {
    for (const [scopeId, timer] of this.saveTimers) {
      clearTimeout(timer);
      this.startPendingSave(scopeId);
    }
    await Promise.allSettled([...this.outstandingWrites]);
    await this.store.flush();
    if (this.writeFailures.size > 0) {
      throw new AggregateError(
        [...this.writeFailures.values()],
        "One or more Browser tab sessions could not be saved.",
      );
    }
  }

  freeze(): void {
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
  }

  private startPendingSave(scopeId: number): void {
    this.saveTimers.delete(scopeId);
    if (!this.pendingSaves.has(scopeId)) return;
    const data = this.pendingSaves.get(scopeId) ?? null;
    this.pendingSaves.delete(scopeId);
    let write: Promise<void>;
    write = this.store
      .replaceScope(scopeId, data)
      .then(() => {
        this.writeFailures.delete(scopeId);
      })
      .catch((error: unknown) => {
        this.writeFailures.set(scopeId, error);
        this.reportError(`Could not save Browser tabs: ${errorMessage(error)}`, scopeId);
        throw error;
      })
      .finally(() => this.outstandingWrites.delete(write));
    this.outstandingWrites.add(write);
    void write.catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
