import type { Result } from "electron";

import type { ManagedTab } from "./browser-tab-events";
import type { BrowserFindRequest, BrowserFindResult } from "./browser-types";

interface ActiveFindRequest {
  electronRequestId: number;
  requestToken: string;
}

/** Owns native find sessions and drops results from replaced or destroyed requests. */
export class BrowserFindController {
  private readonly active = new Map<string, ActiveFindRequest>();

  constructor(private readonly emitResult: (result: BrowserFindResult) => void) {}

  find(tab: ManagedTab, request: BrowserFindRequest): void {
    const electronRequestId = tab.webContents.findInPage(request.query, {
      forward: request.forward,
      findNext: request.findNext,
    });
    this.active.set(tab.metadata.id, {
      electronRequestId,
      requestToken: request.requestToken,
    });
  }

  handleResult(tab: ManagedTab, result: Result): void {
    const active = this.active.get(tab.metadata.id);
    if (!active || active.electronRequestId !== result.requestId) return;
    this.emitResult({
      tabId: tab.metadata.id,
      requestToken: active.requestToken,
      activeMatchOrdinal: result.activeMatchOrdinal,
      matches: result.matches,
      finalUpdate: result.finalUpdate,
    });
  }

  invalidate(tab: ManagedTab): void {
    if (!this.active.delete(tab.metadata.id)) return;
    if (!tab.webContents.isDestroyed()) tab.webContents.stopFindInPage("clearSelection");
  }

  stop(tabId: string, tab: ManagedTab | undefined, focusPage: boolean): void {
    this.active.delete(tabId);
    if (!tab || tab.webContents.isDestroyed()) return;
    tab.webContents.stopFindInPage("clearSelection");
    if (focusPage) tab.webContents.focus();
  }
}
