import { useCallback, useMemo } from "react";

import {
  desktopBridge,
  type BrowserResponsiveRequest,
  type BrowserTabMetadata,
} from "@/lib/desktop-bridge";
import { toBrowserResponsiveRequest } from "@/shared/browser-responsive";

export interface BrowserResponsiveModel {
  apply: (request: BrowserResponsiveRequest) => Promise<void>;
  toggle: () => void;
}

export function useBrowserResponsive(
  activeTab: BrowserTabMetadata | null,
  runForActive: (action: (tab: BrowserTabMetadata) => Promise<void>) => Promise<void>,
): BrowserResponsiveModel {
  const apply = useCallback(
    (request: BrowserResponsiveRequest): Promise<void> =>
      runForActive((tab) =>
        desktopBridge.setBrowserResponsive(tab.id, request).then(() => undefined),
      ),
    [runForActive],
  );
  const toggle = useCallback((): void => {
    if (!activeTab) return;
    const request = toBrowserResponsiveRequest(activeTab.responsive);
    void apply({ ...request, enabled: !request.enabled });
  }, [activeTab, apply]);
  return useMemo(() => ({ apply, toggle }), [apply, toggle]);
}
