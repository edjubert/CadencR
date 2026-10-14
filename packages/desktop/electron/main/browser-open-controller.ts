import type { BrowserAutomationAuthority } from "./browser-automation-authority";
import type { BrowserInspectionController } from "./browser-inspection-controller";
import { originOf } from "./browser-manager-utils";
import type { BrowserOpenUrlOptions, BrowserTabMetadata } from "./browser-types";
import type { ManagedTab } from "./browser-tab-events";

interface BrowserOpenHost {
  activeTabId(scopeId: number | null): string | null;
  navigate(tabId: string, url: string): BrowserTabMetadata;
  createAgentTab(url: string, scopeId: number | null): BrowserTabMetadata;
  requireTab(tabId: string): ManagedTab;
}

/** Provider-neutral agent URL opening with per-scope authorization checks. */
export class BrowserOpenController {
  constructor(
    private readonly automation: BrowserAutomationAuthority,
    private readonly inspection: BrowserInspectionController,
    private readonly host: BrowserOpenHost,
  ) {}

  async open(url: string, options: BrowserOpenUrlOptions = {}): Promise<BrowserTabMetadata> {
    const scopeId = options.scopeId ?? null;
    const activeTabId = options.newTab === true ? null : this.host.activeTabId(scopeId);
    const targetTabId = options.tabId ?? activeTabId;
    if (targetTabId) this.automation.assert(targetTabId, scopeId);
    const metadata = targetTabId
      ? this.host.navigate(targetTabId, url)
      : this.host.createAgentTab(url, scopeId);
    await this.inspection.waitForLoad(metadata.id);
    this.automation.assert(metadata.id, scopeId);
    return this.host.requireTab(metadata.id).metadata;
  }

  async openExternal(
    url: string,
    options: BrowserOpenUrlOptions = {},
  ): Promise<BrowserTabMetadata> {
    const metadata = await this.open(url, options);
    const tab = this.host.requireTab(metadata.id);
    this.automation.assert(metadata.id, options.scopeId ?? null);
    tab.externalAutomationOrigin = originOf(tab.webContents.getURL());
    return tab.metadata;
  }
}
