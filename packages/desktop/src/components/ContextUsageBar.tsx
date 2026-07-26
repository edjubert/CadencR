import { memo, type ReactElement, useState } from "react";
import { normalizeContextWindow, totalTokens, type ContextUsageState } from "@/types/agent";
import { cn } from "@/lib/utils";
import {
  getContextUsageAppearance,
  type ContextUsageAppearance,
} from "@/lib/context-usage-appearance";
import { KbdShortcut } from "@/components/KbdShortcut";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
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
          className="pointer-events-none w-auto min-w-[160px] p-3"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <ContextUsageDetails usage={usage} />
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

function ContextUsageDetails({ usage }: { usage: ContextUsageState }): ReactElement {
  const windowSize = normalizeContextWindow(usage.contextWindow);
  const used = totalTokens(usage);
  const ratio = windowSize == null ? 0 : Math.min(1, used / windowSize);
  const appearance = getContextUsageAppearance(ratio);
  const usedLabel = `${used.toLocaleString()} / ${windowSize?.toLocaleString() ?? "—"}`;

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
