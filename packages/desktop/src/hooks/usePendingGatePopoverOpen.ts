import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMostRecentPendingFeatureId,
  useFeaturePendingRequestId,
} from "@/stores/pending-gate-popover-selectors";
import { usePendingGatePopoverHoverStore } from "@/stores/pending-gate-popover-hover-store";
import { useSidebarSample } from "@/lib/sidebar-sample-context";
import { useSidebarOption } from "@/stores/sidebar-config-store";

interface HoverHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface UsePendingGatePopoverOpenResult {
  open: boolean;
  setOpen: (open: boolean) => void;
  setHovered: (featureId: number | null) => void;
  hoveredFeatureId: number | null;
  /** Spread on the trigger and the content in "hover" mode; undefined otherwise. */
  hoverHandlers: HoverHandlers | undefined;
}

/** Hover intent: crossing the list doesn't open every popover on the way. */
const HOVER_OPEN_DELAY_MS = 150;
/** Time to travel from the trigger to the popover before it closes. */
const HOVER_CLOSE_DELAY_MS = 250;

/**
 * Open/close rules for sidebar pending-gate popovers:
 * - most-recent pending feature auto-opens (and reopens on a new request id)
 * - the currently open conversation never auto-opens its sidebar popover
 * - older popovers close when another agent becomes most-recent, unless hovered
 * - the "Gate popover" option (H3) narrows auto-opening: "hover" opens on
 *   pointing at the trigger instead, "click" only on a click
 */
export function usePendingGatePopoverOpen(
  featureId: number,
  allowAutoOpen: boolean,
): UsePendingGatePopoverOpenResult {
  const liveMostRecentFeatureId = useMostRecentPendingFeatureId();
  const livePendingRequestId = useFeaturePendingRequestId(featureId);
  // The display options preview stages its own "newest request".
  const sample = useSidebarSample();
  const mostRecentFeatureId = sample ? sample.mostRecentPendingFeatureId : liveMostRecentFeatureId;
  const pendingRequestId = sample ? sample.pendingRequestId : livePendingRequestId;
  const hoveredFeatureId = usePendingGatePopoverHoverStore((s) => s.hoveredFeatureId);
  const setHovered = usePendingGatePopoverHoverStore((s) => s.setHovered);

  const mode = useSidebarOption("gatePopover");
  const autoOpen = allowAutoOpen && mode === "auto";

  const isMostRecent = mostRecentFeatureId === featureId;
  const isHovered = hoveredFeatureId === featureId;
  const [open, setOpen] = useState(isMostRecent && autoOpen);
  const previousAllowAutoOpenRef = useRef(allowAutoOpen);
  const hoverHandlers = useHoverOpen(setOpen, mode === "hover");

  useEffect(() => {
    if (autoOpen && isMostRecent) setOpen(true);
  }, [autoOpen, featureId, isMostRecent, pendingRequestId]);

  // Navigating into this conversation closes its sidebar popover and clears a
  // hover that may otherwise survive the programmatic close. Manual opening
  // remains available after that transition.
  useEffect(() => {
    const wasAllowed = previousAllowAutoOpenRef.current;
    previousAllowAutoOpenRef.current = allowAutoOpen;
    if (!wasAllowed || allowAutoOpen) return;
    setOpen(false);
    if (hoveredFeatureId === featureId) setHovered(null);
  }, [allowAutoOpen, featureId, hoveredFeatureId, setHovered]);

  // In hover mode the pointer alone decides, with its grace delay.
  const hoverMode = mode === "hover";
  useEffect(() => {
    if (!hoverMode && !isMostRecent && !isHovered) setOpen(false);
  }, [hoverMode, isHovered, isMostRecent]);

  return { open, setOpen, setHovered, hoveredFeatureId, hoverHandlers };
}

/**
 * Opens after a short hover on the trigger and closes once the pointer has
 * left both the trigger and the popover (both spread the same handlers).
 */
function useHoverOpen(
  setOpen: (open: boolean) => void,
  enabled: boolean,
): HoverHandlers | undefined {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving hover mode (or unmounting) drops a pending open or close.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [enabled],
  );
  return useMemo(() => {
    if (!enabled) return undefined;
    const schedule = (open: boolean, delay: number): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setOpen(open);
      }, delay);
    };
    return {
      onPointerEnter: () => schedule(true, HOVER_OPEN_DELAY_MS),
      onPointerLeave: () => schedule(false, HOVER_CLOSE_DELAY_MS),
    };
  }, [enabled, setOpen]);
}
