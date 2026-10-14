import { memo, type ReactElement } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { effectiveGateKind, gatePrompt } from "@/components/sidebar-pending-gate";
import { useFeaturePendingGate } from "@/hooks/useFeaturePendingGate";
import type { Attention } from "@/lib/sidebar-attention";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { cn } from "@/lib/utils";

/**
 * Names what a waiting conversation asks for ("Bash: pnpm test", the question
 * itself) under its title, so the row says why it waits without opening it.
 * Shares the gate popover's query, so answering from either refreshes both.
 * Renders nothing unless the row (or a child folded under it) is waiting.
 */
export function SidebarPendingRequestLine({
  attention,
}: {
  attention: Attention;
}): ReactElement | null {
  if (attention.state !== "waiting") return null;
  return <PendingRequestLine featureId={attention.sourceFeatureId} />;
}

const PendingRequestLine = memo(function PendingRequestLine({
  featureId,
}: {
  /** The conversation that asks: the row itself or a child folded under it. */
  featureId: number;
}): ReactElement | null {
  const enabled = useSidebarOption("pendingRequest");
  const { gate, isLoading, errorMessage } = useFeaturePendingGate({ featureId, enabled });
  if (!enabled) return null;
  if (isLoading) return <Skeleton data-feature-pending-request className="my-0.5 h-3 w-28" />;
  if (errorMessage) {
    return (
      <span data-feature-pending-request title={errorMessage} className={LINE_CLASS}>
        Request details unavailable
      </span>
    );
  }
  const prompt = gate ? gatePrompt(gate) : null;
  if (!gate || !prompt) return null;
  return (
    <span
      data-feature-pending-request
      title={prompt}
      className={cn(
        LINE_CLASS,
        effectiveGateKind(gate) === "question"
          ? "text-primary"
          : "text-(--acc-yellow,var(--color-amber-400))",
      )}
    >
      {prompt}
    </span>
  );
});

const LINE_CLASS = "min-w-0 truncate text-[11px] leading-4 text-muted-foreground";
