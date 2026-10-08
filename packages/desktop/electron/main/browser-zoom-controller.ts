import type { ManagedTab } from "./browser-tab-events";
import { zoomWebContents } from "./browser-manager-utils";

type ZoomAction = "in" | "out" | "reset";

/** Keeps renderer metadata aligned with Chromium's origin-scoped guest zoom. */
export class BrowserZoomController {
  constructor(
    private readonly tabs: Map<string, ManagedTab>,
    private readonly emitState: (scopeId: number | null) => void,
    private readonly syncResponsive: (tab: ManagedTab) => void = () => undefined,
  ) {}

  apply(tab: ManagedTab, action: ZoomAction): void {
    if (action === "reset") tab.webContents.setZoomFactor(1);
    else zoomWebContents(tab.webContents, action);
    this.sync();
  }

  sync(): void {
    const changedScopes = new Set<number | null>();
    for (const tab of this.tabs.values()) {
      if (tab.webContents.isDestroyed()) continue;
      this.syncResponsive(tab);
      const zoomPercent = Math.round(tab.webContents.getZoomFactor() * 100);
      if (tab.metadata.zoomPercent === zoomPercent) continue;
      tab.metadata = { ...tab.metadata, zoomPercent };
      changedScopes.add(tab.metadata.scopeId);
    }
    for (const scopeId of changedScopes) this.emitState(scopeId);
  }
}
