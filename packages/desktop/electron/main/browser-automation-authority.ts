import type { ManagedTab } from "./browser-tab-events";
import type { BrowserStateSnapshot } from "./browser-types";

/** Per-tab authorization boundary between user browsing and agent automation. */
export class BrowserAutomationAuthority {
  constructor(
    private readonly tabs: Map<string, ManagedTab>,
    private readonly snapshot: (scopeId?: number | null) => BrowserStateSnapshot,
  ) {}

  assert(tabId: string, scopeId?: number | null): ManagedTab {
    const tab = this.tabs.get(tabId);
    const normalizedScopeId = scopeId ?? null;
    if (!tab || tab.metadata.scopeId !== normalizedScopeId) {
      throw new Error("Browser tab is not available to this agent scope.");
    }
    if (tab.automationAccess === "user") {
      throw new Error("Browser tab is not shared with the agent.");
    }
    return tab;
  }

  state(scopeId?: number | null): BrowserStateSnapshot {
    const state = this.snapshot(scopeId ?? null);
    const allowedIds = new Set(
      state.tabs
        .filter((tab) => {
          const access = this.tabs.get(tab.id)?.automationAccess;
          return access === "shared" || access === "agent";
        })
        .map((tab) => tab.id),
    );
    return {
      ...state,
      tabs: state.tabs.filter((tab) => allowedIds.has(tab.id)),
      activeTabId:
        state.activeTabId && allowedIds.has(state.activeTabId) ? state.activeTabId : null,
      consoleEntries: state.consoleEntries.filter((entry) => allowedIds.has(entry.tabId)),
      networkEntries: state.networkEntries.filter((entry) => allowedIds.has(entry.tabId)),
      knownOrigins: [],
      error: null,
    };
  }

  guard(tabId: string, scopeId?: number | null): () => void {
    this.assert(tabId, scopeId);
    return () => {
      this.assert(tabId, scopeId);
    };
  }
}
