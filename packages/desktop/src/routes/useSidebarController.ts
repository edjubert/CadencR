import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/components/AppShell";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useSidebarAutoCollapse } from "@/hooks/useSidebarAutoCollapse";

function clampSidebarWidth(raw: string | null): number {
  const saved = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(saved)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved));
}

/**
 * Owns the global sidebar's width and collapse state.
 *
 * The persisted width is the single restore target. react-resizable-panels'
 * own "expand to previous size" memory lives in per-registration mutable state
 * that a Panel prop change wipes, so expanding through it could land on
 * `minSize` and then persist that. Instead the Panel's `defaultSize` is frozen
 * at mount, the stored width is applied imperatively once it loads, and every
 * expand resizes back to it. Layout events are ignored until that first load
 * has been applied, so the mount-time `onLayoutChanged` cannot overwrite the
 * stored width with the default. A narrow window can fold the sidebar on top
 * of the stored state (A8, never persisted).
 */
export function useSidebarController(isMobile: boolean) {
  const leftWidth = useDebouncedSetting("sidebar_left_width", 300, { immediateCache: false });
  const collapsedSetting = useDebouncedSetting("sidebar_collapsed", 0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const autoCollapse = useSidebarAutoCollapse(isMobile);
  const collapsed = isMobile
    ? !mobileDrawerOpen
    : collapsedSetting.value === "true" || autoCollapse.autoCollapsed;
  const storedWidth = clampSidebarWidth(leftWidth.value);
  const [defaultLeftSize] = useState(() => `${storedWidth}px`);
  const widthAppliedRef = useRef(false);

  const restoreWidth = useCallback(
    (panel: PanelImperativeHandle): void => {
      panel.resize(`${storedWidth}px`);
    },
    [storedWidth],
  );

  const setCollapsed = useCallback(
    (nextCollapsed: boolean): void => {
      if (isMobile) setMobileDrawerOpen(!nextCollapsed);
      else {
        // Resize while the Panel is still collapsible; the next render makes
        // it non-collapsible so pointer and keyboard resizing clamp at minSize.
        const panel = sidebarPanelRef.current;
        if (!nextCollapsed && panel) restoreWidth(panel);
        if (autoCollapse.onUserToggle(nextCollapsed)) return;
        collapsedSetting.setValue(nextCollapsed ? "true" : "false");
      }
    },
    [autoCollapse, collapsedSetting, isMobile, restoreWidth],
  );
  const closeMobileDrawer = useCallback((): void => setMobileDrawerOpen(false), []);
  useEffect(() => {
    document.documentElement.dataset.sidebarCollapsed = collapsed ? "true" : "false";
  }, [collapsed]);

  useEffect(() => {
    if (isMobile || !leftWidth.isFetched || !collapsedSetting.isFetched) return;
    if (widthAppliedRef.current) return;
    widthAppliedRef.current = true;
    const panel = sidebarPanelRef.current;
    if (panel && !collapsed) restoreWidth(panel);
  }, [collapsed, collapsedSetting.isFetched, isMobile, leftWidth.isFetched, restoreWidth]);

  // A changed `collapsible` reaches the Panel one render later, so the
  // `collapse()` riding the same commit no-ops and the sidebar keeps its width.
  // Retry once it lands; re-setting the same flag bails out instead of looping.
  const [retryCollapse, setRetryCollapse] = useState(false);
  useEffect(() => {
    if (isMobile || !collapsedSetting.isFetched) return;
    const panel = sidebarPanelRef.current;
    if (!panel || panel.isCollapsed() === collapsed) {
      setRetryCollapse(false);
      return;
    }
    if (collapsed) panel.collapse();
    else restoreWidth(panel);
    setRetryCollapse(collapsed && !panel.isCollapsed());
  }, [collapsed, collapsedSetting.isFetched, isMobile, restoreWidth, retryCollapse]);
  useEffect(() => {
    leftSidebarRef.current?.focus();
  }, []);

  const handleLayoutChanged = useCallback((): void => {
    if (!widthAppliedRef.current) return;
    const size = sidebarPanelRef.current?.getSize();
    if (!size || size.inPixels < 50) return;
    const width = Math.round(size.inPixels);
    // Percent-based layout rounds a restored width by a pixel; persisting that
    // would shrink the sidebar a little on every launch.
    if (Math.abs(width - storedWidth) <= 1) return;
    leftWidth.setValue(String(width));
  }, [leftWidth, storedWidth]);

  return useMemo(
    () => ({
      closeMobileDrawer,
      collapsed,
      defaultLeftSize,
      handleLayoutChanged,
      leftSidebarRef,
      setCollapsed,
      sidebarPanelRef,
    }),
    [closeMobileDrawer, collapsed, defaultLeftSize, handleLayoutChanged, setCollapsed],
  );
}

export type SidebarController = ReturnType<typeof useSidebarController>;
