import type { ReactElement } from "react";
import { AlertTriangleIcon, GlobeIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export { BrowserTabStrip } from "./BrowserTabStrip";

export function BrowserLoading(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <GlobeIcon className="size-6 animate-pulse" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Starting browser…
      </div>
    </div>
  );
}

export function BrowserEmptyState({
  onNewTab,
  creating = false,
}: {
  onNewTab: () => void;
  creating?: boolean;
}): ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GlobeIcon className="size-7" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No browser tab open</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a tab to preview your app, then send the page context straight to the agent.
        </p>
      </div>
      <Button size="sm" onClick={onNewTab} disabled={creating} aria-busy={creating}>
        {creating ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <PlusIcon className="size-4" />
        )}
        {creating ? "Opening tab…" : "New tab"}
      </Button>
    </div>
  );
}

export function BrowserError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        aria-label="Dismiss browser error"
        className="rounded p-1 hover:bg-destructive/15"
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
