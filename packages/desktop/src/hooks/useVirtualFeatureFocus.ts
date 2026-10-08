import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { ListRange, VirtuosoHandle } from "react-virtuoso";

export function useVirtualFeatureFocus(
  featureIds: readonly number[],
  rootRef: RefObject<HTMLDivElement | null>,
  virtuosoRef: RefObject<VirtuosoHandle | null>,
  indexAttribute: string,
): { focusIndex: (index: number) => void; handleRangeChanged: (range: ListRange) => void } {
  const pendingFeatureIdRef = useRef<number | null>(null);
  useEffect(() => {
    const featureId = pendingFeatureIdRef.current;
    if (featureId == null) return;
    const index = featureIds.indexOf(featureId);
    if (index < 0) pendingFeatureIdRef.current = null;
    else virtuosoRef.current?.scrollIntoView({ index, align: "center" });
  }, [featureIds, virtuosoRef]);
  const focusIndex = useCallback(
    (index: number): void => {
      const mounted = rootRef.current?.querySelector<HTMLElement>(
        `[${indexAttribute}="${index}"] [data-nav-item]`,
      );
      if (mounted) {
        mounted.focus({ focusVisible: true } as FocusOptions);
        return;
      }
      pendingFeatureIdRef.current = featureIds[index] ?? null;
      virtuosoRef.current?.scrollToIndex({ index, align: "center" });
    },
    [featureIds, indexAttribute, rootRef, virtuosoRef],
  );
  const handleRangeChanged = useCallback(
    (range: ListRange): void => {
      const featureId = pendingFeatureIdRef.current;
      if (featureId == null) return;
      const index = featureIds.indexOf(featureId);
      if (index < 0) {
        pendingFeatureIdRef.current = null;
        return;
      }
      if (index < range.startIndex || index > range.endIndex) return;
      pendingFeatureIdRef.current = null;
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector<HTMLElement>(`[${indexAttribute}="${index}"] [data-nav-item]`)
          ?.focus({ focusVisible: true } as FocusOptions);
      });
    },
    [featureIds, indexAttribute, rootRef],
  );
  return useMemo(() => ({ focusIndex, handleRangeChanged }), [focusIndex, handleRangeChanged]);
}

export function useMeasuredActiveRange(
  activeIndex: number,
  activeKey: unknown,
  virtuosoRef: RefObject<VirtuosoHandle | null>,
  onRangeChanged: (range: ListRange) => void,
  revealKey: unknown,
): (range: ListRange) => void {
  const pendingActiveIndexRef = useRef<number | null>(activeIndex >= 0 ? activeIndex : null);
  const lastActiveKeyRef = useRef<unknown>(Symbol("uninitialized-active-key"));
  const lastRevealKeyRef = useRef<unknown>(Symbol("uninitialized-reveal-key"));
  const armedActiveKeyRef = useRef<unknown>(activeKey);
  useEffect(() => {
    if (
      !Object.is(lastActiveKeyRef.current, activeKey) ||
      !Object.is(lastRevealKeyRef.current, revealKey)
    ) {
      lastActiveKeyRef.current = activeKey;
      lastRevealKeyRef.current = revealKey;
      armedActiveKeyRef.current = activeKey;
    }
    if (!Object.is(armedActiveKeyRef.current, activeKey) || activeIndex < 0) return;
    armedActiveKeyRef.current = Symbol("revealed-active-key");
    pendingActiveIndexRef.current = activeIndex;
    virtuosoRef.current?.scrollToIndex({ index: activeIndex, align: "center" });
  }, [activeIndex, activeKey, revealKey, virtuosoRef]);
  return useCallback(
    (range: ListRange): void => {
      onRangeChanged(range);
      const pendingIndex = pendingActiveIndexRef.current;
      if (pendingIndex == null) return;
      if (pendingIndex >= range.startIndex && pendingIndex <= range.endIndex) {
        pendingActiveIndexRef.current = null;
        return;
      }
      virtuosoRef.current?.scrollToIndex({ index: pendingIndex, align: "center" });
    },
    [onRangeChanged, virtuosoRef],
  );
}
