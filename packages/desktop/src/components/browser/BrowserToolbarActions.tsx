import { memo, useRef, type ReactElement } from "react";
import {
  BugIcon,
  ExternalLinkIcon,
  MonitorSmartphoneIcon,
  MoreHorizontalIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { formatCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import { BrowserExternalButton } from "./BrowserExternalButton";

interface BrowserToolbarActionsProps {
  activeTab: BrowserTabMetadata | null;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onDevTools: () => void;
  onOpenExternal: () => void;
  onFind: () => void;
  onAddComment: () => void;
  onResponsive: () => void;
  onMenuOpenChange: (open: boolean) => void;
}

function BrowserZoomMenuItems(props: BrowserToolbarActionsProps): ReactElement {
  const disabled = !props.activeTab;
  const zoomPercent = props.activeTab?.zoomPercent ?? 100;
  return (
    <>
      <DropdownMenuItem disabled={disabled} onSelect={props.onZoomOut}>
        <MinusIcon /> Zoom out
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-label={`Reset zoom (${zoomPercent}%)`}
        disabled={disabled}
        onSelect={props.onZoomReset}
      >
        Reset zoom
        <span className="ml-auto min-w-10 text-right font-mono text-[10px] text-muted-foreground">
          {zoomPercent}%
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled} onSelect={props.onZoomIn}>
        <PlusIcon /> Zoom in
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function BrowserOverflowMenu(
  props: BrowserToolbarActionsProps & { devToolsShortcut: string },
): ReactElement {
  const focusFindAfterClose = useRef(false);
  const disabled = !props.activeTab;
  function handleFindSelect(): void {
    focusFindAfterClose.current = true;
  }
  function handleCloseAutoFocus(event: Event): void {
    if (!focusFindAfterClose.current) return;
    focusFindAfterClose.current = false;
    event.preventDefault();
    props.onFind();
  }
  return (
    <DropdownMenu onOpenChange={props.onMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="hidden shrink-0 @max-[50rem]:inline-flex"
          disabled={disabled}
          aria-label="More Browser actions"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={handleCloseAutoFocus}>
        <BrowserZoomMenuItems {...props} />
        <DropdownMenuItem onSelect={handleFindSelect}>
          <SearchIcon /> Find in page
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onResponsive}>
          <MonitorSmartphoneIcon />
          {props.activeTab?.responsive.enabled ? "Exit responsive mode" : "Responsive mode"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onDevTools}>
          <BugIcon /> DevTools
          {props.devToolsShortcut ? (
            <span className="ml-auto text-xs tracking-widest text-muted-foreground">
              {props.devToolsShortcut}
            </span>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onSelect={props.onOpenExternal}
          title="Cookies and sign-in state are not transferred"
        >
          <ExternalLinkIcon /> Open in default browser
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={props.onAddComment}>
          <SparklesIcon /> Add comment
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const BrowserToolbarActions = memo(function BrowserToolbarActions(
  props: BrowserToolbarActionsProps,
): ReactElement {
  const disabled = !props.activeTab;
  const zoomPercent = props.activeTab?.zoomPercent ?? 100;
  const responsive = props.activeTab?.responsive.enabled === true;
  const devToolsShortcut = formatCombo(useResolvedShortcut("browser-devtools").keys).join("");
  return (
    <>
      <div className="flex shrink-0 items-center rounded-md bg-muted/50 p-0.5 @max-[28rem]:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          onClick={props.onZoomOut}
          aria-label="Zoom out"
        >
          <MinusIcon className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={props.onZoomReset}
          aria-label="Reset page zoom to 100%"
          className="min-w-11 px-1 font-mono text-[10px]"
        >
          {zoomPercent}%
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          onClick={props.onZoomIn}
          aria-label="Zoom in"
        >
          <PlusIcon className="size-3" />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 @max-[50rem]:hidden">
        <BrowserExternalButton disabled={disabled} onClick={props.onOpenExternal} />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={props.onFind}
          aria-label="Find in page"
        >
          <SearchIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant={responsive ? "secondary" : "ghost"}
          size="icon-sm"
          disabled={disabled}
          onClick={props.onResponsive}
          aria-label={responsive ? "Exit responsive mode" : "Open responsive mode"}
          aria-pressed={responsive}
        >
          <MonitorSmartphoneIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={props.onDevTools}
          aria-label="DevTools"
          title={devToolsShortcut ? `DevTools (${devToolsShortcut})` : "DevTools"}
        >
          <BugIcon className="size-4" />
        </Button>
        <Button type="button" size="sm" disabled={disabled} onClick={props.onAddComment}>
          <SparklesIcon className="size-3.5" /> Add comment
        </Button>
      </div>
      <BrowserOverflowMenu {...props} devToolsShortcut={devToolsShortcut} />
    </>
  );
});
