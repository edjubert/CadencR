import { forwardRef, type ComponentPropsWithoutRef, type DragEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const BROWSER_TAB_DRAG_TYPE = "application/x-cadencr-browser-tab";

interface BrowserTabDragSurfaceProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "onDrop" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDragEnd"
> {
  tabId: string;
  busy: boolean;
  active: boolean;
  dragging: boolean;
  dropTarget: boolean;
  acceptsDrop: boolean;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (tabId: string) => void;
  onDragOver: (tabId: string) => void;
  onDragLeave: (tabId: string) => void;
  onDragEnd: () => void;
  children: ReactNode;
}

export const BrowserTabDragSurface = forwardRef<HTMLDivElement, BrowserTabDragSurfaceProps>(
  function BrowserTabDragSurface(
    {
      tabId,
      busy,
      active,
      dragging,
      dropTarget,
      acceptsDrop,
      onDrop,
      onDragStart,
      onDragOver,
      onDragLeave,
      onDragEnd,
      children,
      className,
      ...domProps
    },
    ref,
  ) {
    return (
      <div
        {...domProps}
        ref={ref}
        draggable={!busy}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(BROWSER_TAB_DRAG_TYPE, tabId);
          onDragStart(tabId);
        }}
        onDragOver={(event) => {
          if (!acceptsDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onDragOver(tabId);
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          onDragLeave(tabId);
        }}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        data-dragging={dragging || undefined}
        data-drop-target={dropTarget || undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/tab flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs transition-colors",
          active
            ? "bg-primary/15 font-medium text-foreground shadow-xs ring-1 ring-inset ring-primary/60"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
          dragging &&
            "bg-primary/10 opacity-40 outline outline-1 outline-dashed outline-primary/70",
          dropTarget && "ring-2 ring-inset ring-primary/80",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
