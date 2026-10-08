import { BrowserSiteController } from "./browser-site-controller";
import type { ManagedTab } from "./browser-tab-events";
import type {
  BrowserSiteInfo,
  BrowserSitePermission,
  BrowserSitePermissionDecision,
} from "./browser-types";

/** Tab-id facade used by trusted renderer IPC. */
export class BrowserSiteApi {
  constructor(
    private readonly controller: BrowserSiteController,
    private readonly requireTab: (tabId: string) => ManagedTab,
  ) {}

  info(tabId: string): BrowserSiteInfo {
    return this.controller.info(this.requireTab(tabId));
  }

  setPermission(
    tabId: string,
    origin: string,
    permission: BrowserSitePermission,
    decision: BrowserSitePermissionDecision,
  ): BrowserSiteInfo {
    return this.controller.setPermissionDecision(
      this.requireTab(tabId),
      origin,
      permission,
      decision,
    );
  }

  clearData(tabId: string, origin: string): Promise<BrowserSiteInfo> {
    return this.controller.clearSiteData(this.requireTab(tabId), origin);
  }

  setSharing(tabId: string, origin: string, shared: boolean): BrowserSiteInfo {
    const tab = this.requireTab(tabId);
    const info = this.controller.setAgentAccess(tab, origin, shared);
    if (!shared) tab.externalAutomationOrigin = null;
    return info;
  }

  resolvePermissionRequest(requestId: string, allowed: boolean): void {
    this.controller.resolvePermissionRequest(requestId, allowed);
  }
}
