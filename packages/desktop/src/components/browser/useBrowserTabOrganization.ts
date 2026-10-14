import { useCallback, useMemo, useRef, useState } from "react";

import { desktopBridge } from "@/lib/desktop-bridge";
import { showBrowserError } from "./browser-errors";

export interface BrowserTabOrganization {
  pendingAction: string | null;
  duplicateTab: (tabId: string) => void;
  setTabPinned: (tabId: string, pinned: boolean) => void;
  reorderTab: (tabId: string, targetIndex: number) => void;
  closeOtherTabs: (tabId: string) => void;
  reopenLastClosedTab: () => void;
}

export function useBrowserTabOrganization(scopeId: number): BrowserTabOrganization {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const run = useCallback((label: string, operation: () => Promise<unknown>): void => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingAction(label);
    void operation()
      .catch((error: unknown) => showBrowserError(error, `Could not ${label}`))
      .finally(() => {
        pendingRef.current = false;
        setPendingAction(null);
      });
  }, []);
  const duplicateTab = useCallback(
    (tabId: string) => run("duplicate tab", () => desktopBridge.duplicateBrowserTab(tabId)),
    [run],
  );
  const setTabPinned = useCallback(
    (tabId: string, pinned: boolean) =>
      run(pinned ? "pin tab" : "unpin tab", () => desktopBridge.setBrowserTabPinned(tabId, pinned)),
    [run],
  );
  const reorderTab = useCallback(
    (tabId: string, targetIndex: number) =>
      run("move tab", () => desktopBridge.reorderBrowserTab(tabId, targetIndex)),
    [run],
  );
  const closeOtherTabs = useCallback(
    (tabId: string) => run("close other tabs", () => desktopBridge.closeOtherBrowserTabs(tabId)),
    [run],
  );
  const reopenLastClosedTab = useCallback(
    () => run("reopen tab", () => desktopBridge.reopenLastClosedBrowserTab(scopeId)),
    [run, scopeId],
  );
  return useMemo(
    () => ({
      pendingAction,
      duplicateTab,
      setTabPinned,
      reorderTab,
      closeOtherTabs,
      reopenLastClosedTab,
    }),
    [closeOtherTabs, duplicateTab, pendingAction, reopenLastClosedTab, reorderTab, setTabPinned],
  );
}
