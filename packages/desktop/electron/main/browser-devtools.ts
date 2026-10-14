import { WebContentsView } from "electron";
import { secureWebPreferences } from "./browser-manager-utils";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserTabMetadata } from "./browser-types";

export function toggleTabDevTools(
  tab: ManagedTab,
  applyLayout: () => void,
  emitState: () => void,
  onDevToolsReady: () => void,
): BrowserTabMetadata {
  if (!tab.devtoolsView) {
    tab.devtoolsView = new WebContentsView({
      webPreferences: secureWebPreferences(tab.profile),
    });
    tab.devtoolsWebContents = tab.devtoolsView.webContents;
    tab.devtoolsWebContents.on("did-finish-load", onDevToolsReady);
    tab.webContents.setDevToolsWebContents(tab.devtoolsWebContents);
  }
  const open = !tab.metadata.devToolsOpen;
  tab.metadata = { ...tab.metadata, devToolsOpen: open };
  applyLayout();
  if (open) tab.webContents.openDevTools({ mode: "detach" });
  else tab.webContents.closeDevTools();
  emitState();
  return tab.metadata;
}

export function inspectTabElement(
  tab: ManagedTab,
  x: number,
  y: number,
  openDevTools: () => void,
): void {
  if (!tab.metadata.devToolsOpen) openDevTools();
  tab.webContents.inspectElement(x, y);
}
