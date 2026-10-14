import { useEffect, useRef, useState, type ReactElement } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarDisplayOptionsForm } from "@/components/SidebarDisplayOptions";
import { cn } from "@/lib/utils";
import { useSidebarPreviewStore } from "@/stores/sidebar-preview-store";

/** Space between the sidebar's edge and the popover. */
const POPOVER_GAP_PX = 8;

/**
 * Header button that opens the display options beside the sidebar, never over
 * it: the rows stay visible, so each change previews live.
 */
export function SidebarDisplayOptionsPopover({ className }: { className?: string }): ReactElement {
  const [sideOffset, setSideOffset] = useState(POPOVER_GAP_PX);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const setOptionsOpen = useSidebarPreviewStore((state) => state.setOptionsOpen);
  // The sidebar shows samples only while this is open; collapsing it unmounts the trigger.
  useEffect(() => () => setOptionsOpen(false), [setOptionsOpen]);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open && triggerRef.current) setSideOffset(offsetPastSidebar(triggerRef.current));
        setOptionsOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon-xs"
          title="Display options"
          aria-label="Display options"
          className={cn("can-hover:data-[state=open]:opacity-100", className)}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={sideOffset}
        className="max-h-(--radix-popover-content-available-height) w-[24rem] overflow-y-auto p-3"
        onInteractOutside={keepOpenForPreview}
      >
        <SidebarDisplayOptionsForm />
      </PopoverContent>
    </Popover>
  );
}

/** Using the preview (samples, replay, their popovers) is part of choosing options. */
function keepOpenForPreview(event: Event): void {
  if (event.target instanceof Element && event.target.closest("[data-sidebar-sample]")) {
    event.preventDefault();
  }
}

/** Distance from the trigger to just past the sidebar's right edge. */
function offsetPastSidebar(trigger: HTMLElement): number {
  const sidebar = trigger.closest("[data-app-sidebar]");
  if (!sidebar) return POPOVER_GAP_PX;
  const gap = sidebar.getBoundingClientRect().right - trigger.getBoundingClientRect().right;
  return Math.max(0, gap) + POPOVER_GAP_PX;
}
