import { memo, type ReactElement, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { normalizeContextWindow, totalTokens, type ContextUsageState } from "@/types/agent";
import { cn } from "@/lib/utils";
import {
  getContextUsageAppearance,
  type ContextUsageAppearance,
} from "@/lib/context-usage-appearance";
import { KbdShortcut } from "@/components/KbdShortcut";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useClaudeCodeOauthUsage } from "@/hooks/useClaudeCodeOauthUsage";

export function ContextUsageBar({
  usage,
  className,
  isStreaming,
}: {
  usage: ContextUsageState | null | undefined;
  className?: string;
  isStreaming: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const quota = useClaudeCodeOauthUsage(open);
  const closeTimeoutRef = useRef<number | undefined>(undefined);

  function cancelScheduledClose(): void {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = undefined;
    }
  }

  // A short grace period, not an immediate close: the popover content sits
  // visually above the trigger, so the pointer briefly leaves the trigger's
  // DOM bounds while travelling toward it (e.g. to click "refresh quota").
  // Without this, that transition would close the popover before the click
  // lands.
  function scheduleClose(): void {
    cancelScheduledClose();
    closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 150);
  }

  function openNow(): void {
    cancelScheduledClose();
    setOpen(true);
  }

  if (!usage) return null;
  const windowSize = normalizeContextWindow(usage.contextWindow);
  if (windowSize == null) return null;

  const used = totalTokens(usage);
  const ratio = Math.min(1, used / windowSize);
  const percent = Math.round(ratio * 100);
  const appearance = getContextUsageAppearance(ratio);
  const usedFormatted = used.toLocaleString();
  const windowFormatted = windowSize.toLocaleString();
  const ariaLabel = `Context usage ${percent}%: ${usedFormatted} of ${windowFormatted} tokens`;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              "flex min-w-0 flex-1 cursor-help items-center gap-2 rounded-sm",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            onFocus={openNow}
            onBlur={scheduleClose}
          >
            <ContextUsageMeter ratio={ratio} appearance={appearance} isStreaming={isStreaming} />
            <span className="shrink-0 text-[10.5px] font-medium tabular-nums text-muted-foreground">
              {percent}%
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-auto min-w-[200px] p-3"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
        >
          <ContextUsageDetails usage={usage} quota={quota} />
        </PopoverContent>
      </Popover>
      <PromptKeyboardHint />
    </div>
  );
}

const ContextUsageMeter = memo(function ContextUsageMeter({
  ratio,
  appearance,
  isStreaming = false,
  className,
}: {
  ratio: number;
  appearance: ContextUsageAppearance;
  isStreaming?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("h-[3px] flex-1 rounded-full bg-border/80", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width,box-shadow] duration-150 ease-out",
          isStreaming ? "context-usage-glow" : appearance.barClassName,
        )}
        data-context-usage-style="glow"
        style={{
          width: `${ratio * 100}%`,
          backgroundColor: appearance.glowColor,
          boxShadow: isStreaming
            ? `0 0 4px ${appearance.glowColor}, 0 0 10px color-mix(in srgb, ${appearance.glowColor} 75%, transparent), 0 0 16px color-mix(in srgb, ${appearance.glowColor} 45%, transparent)`
            : "none",
        }}
      />
    </div>
  );
});

function formatCostUsd(costUsd: number): string {
  return `$${costUsd.toFixed(2)}`;
}

function formatFetchedAgo(fetchedAt: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - fetchedAt);
  return `fetched ${seconds}s ago`;
}

const QUOTA_WINDOWS: Array<{
  key: "five_hour" | "seven_day" | "seven_day_sonnet" | "seven_day_opus";
  label: string;
}> = [
  { key: "five_hour", label: "5h" },
  { key: "seven_day", label: "7d" },
  { key: "seven_day_sonnet", label: "7d Sonnet" },
  { key: "seven_day_opus", label: "7d Opus" },
];

function ContextUsageDetails({
  usage,
  quota,
}: {
  usage: ContextUsageState;
  quota: ReturnType<typeof useClaudeCodeOauthUsage>;
}): ReactElement {
  const windowSize = normalizeContextWindow(usage.contextWindow);
  const used = totalTokens(usage);
  const ratio = windowSize == null ? 0 : Math.min(1, used / windowSize);
  const appearance = getContextUsageAppearance(ratio);
  const usedLabel = `${used.toLocaleString()} / ${windowSize?.toLocaleString() ?? "—"}`;
  const quotaFetchFailed = quota.status === "unavailable" && quota.reason !== "not authenticated via claude login";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-foreground">Context</span>
      <ContextUsageMeter ratio={ratio} appearance={appearance} className="h-1" />
      <p className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{usedLabel}</p>
      {usage.costUsd != null ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
          <span className="text-[10.5px] text-muted-foreground">Session cost</span>
          <span className="font-mono text-[10.5px] font-medium tabular-nums text-foreground">
            {formatCostUsd(usage.costUsd)}
          </span>
        </div>
      ) : null}
      {usage.wasCompacted ? (
        <p className="border-t border-border pt-2 text-[10.5px] font-medium text-[var(--acc-orange)]">
          Context compacted
        </p>
      ) : null}
      {quota.status === "available" && quota.snapshot ? (
        <div className="flex flex-col gap-1.5 border-t border-border pt-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-muted-foreground">Account quota</span>
            <button
              type="button"
              aria-label="Refresh quota"
              disabled={quota.isRefreshing}
              onClick={quota.refresh}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {quota.isRefreshing ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-3" aria-hidden />
              )}
            </button>
          </div>
          {QUOTA_WINDOWS.map(({ key, label }) => {
            const window = quota.snapshot![key];
            const barAppearance = getContextUsageAppearance(window.utilization);
            return (
              <div key={key} className="flex items-center justify-between gap-2">
                <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{label}</span>
                <div className="h-1 flex-1 rounded-full bg-border/80">
                  <div
                    className={cn("h-full rounded-full", barAppearance.barClassName)}
                    style={{ width: `${window.utilization * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(window.utilization * 100)}%
                </span>
              </div>
            );
          })}
          {quota.fetchedAt != null ? (
            <div className="text-right text-[10px] text-muted-foreground">
              {formatFetchedAgo(quota.fetchedAt)}
            </div>
          ) : null}
        </div>
      ) : null}
      {quotaFetchFailed ? (
        <div className="border-t border-border pt-1.5 text-[10.5px] text-muted-foreground">
          Quota unavailable right now
        </div>
      ) : null}
    </div>
  );
}

function PromptKeyboardHint(): ReactElement {
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
      <KbdShortcut keys={["enter"]} variant="hint" />
      <span>send</span>
      <span className="text-muted-foreground">·</span>
      <KbdShortcut keys={["shift", "enter"]} variant="hint" />
      <span>newline</span>
    </span>
  );
}
