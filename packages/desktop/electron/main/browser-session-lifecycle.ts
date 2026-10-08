import { session } from "electron";
import { browserPartitionForProfile, type BrowserProfile } from "./browser-profiles";

export type BrowserSessionCleaner = (partition: string) => Promise<void>;

/**
 * Owns the lifetime of private browser partitions. Persistent and feature
 * profiles keep their existing lifecycle; only a fresh profile represents the
 * user-facing Private mode and must be erased after its final tab closes.
 */
export class BrowserSessionLifecycle {
  private readonly owners = new Map<string, number>();
  private readonly cleanups = new Map<string, Promise<void>>();

  constructor(private readonly clearSession: BrowserSessionCleaner = clearPrivateSession) {}

  assertAvailable(profile: BrowserProfile): void {
    if (!isPrivateProfile(profile)) return;
    const partition = browserPartitionForProfile(profile);
    if (this.cleanups.has(partition)) {
      throw new Error(
        `Private browser session is unavailable while it is being cleared: ${partition}`,
      );
    }
  }

  claim(profile: BrowserProfile): void {
    this.assertAvailable(profile);
    if (!isPrivateProfile(profile)) return;
    const partition = browserPartitionForProfile(profile);
    this.owners.set(partition, (this.owners.get(partition) ?? 0) + 1);
  }

  /**
   * Hold a private partition independently of a tab. Downloads use this lease
   * so closing their source tab cannot clear cookies or connections mid-flight.
   */
  acquire(profile: BrowserProfile): () => Promise<void> {
    this.claim(profile);
    let released = false;
    return async (): Promise<void> => {
      if (released) return;
      released = true;
      await this.release(profile);
    };
  }

  async release(profile: BrowserProfile): Promise<void> {
    if (!isPrivateProfile(profile)) return;
    const partition = browserPartitionForProfile(profile);
    const ownerCount = this.owners.get(partition);
    if (!ownerCount)
      throw new Error(`Private browser session has no registered owner: ${partition}`);
    if (ownerCount > 1) {
      this.owners.set(partition, ownerCount - 1);
      return;
    }

    this.owners.delete(partition);
    const cleanup = Promise.resolve().then(() => this.clearSession(partition));
    this.cleanups.set(partition, cleanup);
    try {
      await cleanup;
      this.cleanups.delete(partition);
    } catch (error) {
      // Keep the failed partition unavailable. Reusing it could expose private
      // state that the failed cleanup left behind.
      throw new Error(`Could not clear private browser session ${partition}`, { cause: error });
    }
  }
}

export function isPrivateProfile(profile: BrowserProfile): boolean {
  return profile.mode === "fresh";
}

/** Await every tab cleanup before reporting their combined failure. */
export async function settleBrowserSessionCleanups(cleanups: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(cleanups);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) throw new AggregateError(failures, "Browser session cleanup failed");
}

async function clearPrivateSession(partition: string): Promise<void> {
  const target = session.fromPartition(partition);
  const failures: unknown[] = [];
  const connectionResult = await Promise.allSettled([target.closeAllConnections()]);
  const clearResults = await Promise.allSettled([target.clearData(), target.clearAuthCache()]);
  for (const result of [...connectionResult, ...clearResults]) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Private browser session cleanup failed");
  }
}
