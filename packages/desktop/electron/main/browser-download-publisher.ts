import { downloadErrorMessage } from "./browser-download-state";
import type { BrowserDownloadSnapshot } from "./browser-types";

export interface BrowserDownloadPublisherOptions {
  emit: (scopeId: number, snapshot: BrowserDownloadSnapshot) => void;
  emitActiveCounts: (counts: Record<number, number>) => void;
  reportError: (message: string, scopeId: number) => void;
}

/** Keeps renderer publication failures outside the native download lifecycle. */
export class BrowserDownloadPublisher {
  private lastActiveCounts: Record<number, number> = {};

  constructor(private readonly options: BrowserDownloadPublisherOptions) {}

  publish(
    scopeId: number,
    snapshot: BrowserDownloadSnapshot,
    activeCounts: Record<number, number>,
  ): void {
    try {
      this.options.emit(scopeId, snapshot);
    } catch (error) {
      this.report(error, "Could not publish download state", scopeId);
    }
    if (countRecordsEqual(this.lastActiveCounts, activeCounts)) return;
    try {
      this.options.emitActiveCounts(activeCounts);
      this.lastActiveCounts = activeCounts;
    } catch (error) {
      this.report(error, "Could not publish active download counts", scopeId);
    }
  }

  report(error: unknown, fallback: string, scopeId: number): void {
    const message = downloadErrorMessage(error, fallback);
    try {
      this.options.reportError(message, scopeId);
    } catch (reportError) {
      console.error(
        `${message}; download error reporter failed: ${downloadErrorMessage(reportError, "Unknown error")}`,
      );
    }
  }
}

function countRecordsEqual(left: Record<number, number>, right: Record<number, number>): boolean {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[Number(key)] === right[Number(key)])
  );
}
