import {
  memo,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from "react";

import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import {
  browserPageBounds,
  fitBrowserResponsiveViewport,
  type BrowserResponsiveGeometry,
} from "@/shared/browser-responsive";
import type { BrowserBounds } from "@/shared/browser-types";

export function useBrowserResponsiveGeometry(
  containerRef: RefObject<HTMLDivElement | null>,
  tab: BrowserTabMetadata | null,
): BrowserResponsiveGeometry | null {
  const [bounds, setBounds] = useState<BrowserBounds | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      const rect = container.getBoundingClientRect();
      setBounds((current) =>
        current?.width === rect.width && current.height === rect.height
          ? current
          : { x: 0, y: 0, width: rect.width, height: rect.height },
      );
    };
    const scheduleMeasure = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(measure);
    };
    scheduleMeasure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [containerRef]);
  return useMemo(() => {
    if (!bounds || !tab?.responsive.enabled) return null;
    return fitBrowserResponsiveViewport(
      browserPageBounds(bounds, tab.devToolsOpen),
      tab.responsive,
    );
  }, [bounds, tab?.devToolsOpen, tab?.responsive]);
}

export const BrowserResponsiveFrame = memo(function BrowserResponsiveFrame({
  geometry,
}: {
  geometry: BrowserResponsiveGeometry | null;
}): ReactElement | null {
  if (!geometry) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bg-background shadow-[0_0_0_1px_var(--border),0_8px_24px_rgba(0,0,0,0.16)]"
      style={geometryStyle(geometry)}
    />
  );
});

export const BrowserSnapshot = memo(function BrowserSnapshot({
  src,
  geometry,
}: {
  src: string;
  geometry: BrowserResponsiveGeometry | null;
}): ReactElement {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute object-fill"
      style={geometry ? geometryStyle(geometry) : { inset: 0, width: "100%", height: "100%" }}
      src={src}
    />
  );
});

export function transformBrowserPageBounds(
  box: BrowserBounds | null,
  geometry: BrowserResponsiveGeometry | null,
): BrowserBounds | null {
  if (!box || !geometry) return box;
  const scale = geometry.displayScale;
  return {
    x: geometry.bounds.x + box.x * scale,
    y: geometry.bounds.y + box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

function geometryStyle(geometry: BrowserResponsiveGeometry): CSSProperties {
  return {
    left: geometry.bounds.x,
    top: geometry.bounds.y,
    width: geometry.bounds.width,
    height: geometry.bounds.height,
  };
}
