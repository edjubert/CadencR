import { responsiveStateFromRequest } from "../../src/shared/browser-responsive";
import type { BrowserScopeState } from "./browser-scope-state";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserResponsiveRequest } from "./browser-types";
import type { BrowserViewLayout } from "./browser-view-layout";

export function responsiveNativeScale(
  layout: BrowserViewLayout,
  scopes: BrowserScopeState,
  tab: ManagedTab,
  request: BrowserResponsiveRequest,
): number {
  const scope = tab.metadata.scopeId;
  const bounds = scopes.bounds.get(scope);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return 1;
  return layout.responsiveGeometry(
    { ...tab, metadata: { ...tab.metadata, responsive: responsiveStateFromRequest(request) } },
    bounds,
    scopes.rendererZoom.get(scope) ?? 1,
  ).nativeScale;
}
