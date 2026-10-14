import { useEffect, useRef, type RefObject, type WheelEvent } from "react";

export function useRevealActiveBrowserTab(
  activeTabId: string | null,
): RefObject<HTMLDivElement | null> {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const activeTab = scrollerRef.current?.querySelector<HTMLElement>("[aria-current='page']");
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);
  return scrollerRef;
}

export function scrollBrowserTabs(event: WheelEvent<HTMLDivElement>): void {
  if (event.deltaX !== 0 || event.deltaY === 0) return;
  const scroller = event.currentTarget;
  const previous = scroller.scrollLeft;
  scroller.scrollLeft += event.deltaY;
  if (scroller.scrollLeft !== previous) event.preventDefault();
}
