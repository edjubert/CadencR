import { memo, useMemo, type ReactElement } from "react";
import { Loader2Icon, MessageCircleQuestionIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_OPTION_CARD_BASE,
  AGENT_OPTION_CARD_RESTING,
} from "@/components/agent-prompt-option-card";
import {
  buildOptions,
  effectiveGateKind,
  gatePrompt,
  triggerPendingKind,
} from "@/components/sidebar-pending-gate";
import { useFeaturePendingGate } from "@/hooks/useFeaturePendingGate";
import { usePendingGatePopoverOpen } from "@/hooks/usePendingGatePopoverOpen";
import { useFeatureStatus } from "@/stores/session-status-selectors";
import type { FeatureGateDecision, FeaturePendingGateResponse } from "@/api/generated";
import type { SessionGateKind } from "@/lib/session-gate";
import { cn } from "@/lib/utils";

interface SidebarPendingGatePopoverProps {
  featureId: number;
  allowAutoOpen: boolean;
  onOpenConversation: () => void;
}

/** ~10 lines of text-xs / leading-snug before the body scrolls. */
const TEXT_SCROLL_CLASS = "max-h-[10lh] overflow-y-auto";

/**
 * Anchored next to a sidebar conversation while it awaits the user.
 *
 * - Single agent: answering keeps the popover open so the next gate in the
 *   queue appears in place (status/`request_id` drive the body).
 * - Multiple agents: only the most-recent pending feature auto-opens; an
 *   older popover stays open while the pointer is over it.
 */
export const SidebarPendingGatePopover = memo(function SidebarPendingGatePopover({
  featureId,
  allowAutoOpen,
  onOpenConversation,
}: SidebarPendingGatePopoverProps): ReactElement {
  const { open, setOpen, setHovered, hoveredFeatureId } = usePendingGatePopoverOpen(
    featureId,
    allowAutoOpen,
  );
  const { kind: livePendingKind } = useFeatureStatus(featureId);
  const { gate, isLoading, isError, errorMessage, isSubmitting, respond } = useFeaturePendingGate({
    featureId,
    enabled: open,
  });
  const gateKind = gate ? effectiveGateKind(gate) : null;
  const isPermissionTrigger = triggerPendingKind(livePendingKind, gateKind) === "permission";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && hoveredFeatureId === featureId) setHovered(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={isPermissionTrigger ? "Pending permission" : "Pending question"}
          className={cn(
            "inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm",
            "hover:bg-sidebar-accent",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isPermissionTrigger ? "text-amber-400" : "text-primary",
          )}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isPermissionTrigger ? (
            <ShieldAlertIcon className="sidebar-pending-indicator size-3.5" />
          ) : (
            <MessageCircleQuestionIcon className="sidebar-pending-indicator size-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className={cn(
          // Keep `bg-popover`: solid outside frost; frost themes blur via theme-frost.css.
          "w-96 max-w-[min(24rem,calc(100vw-2rem))] bg-popover p-0",
          gateKind === "permission" && "border-amber-500/40",
        )}
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={() => setHovered(featureId)}
        onMouseLeave={() => {
          if (hoveredFeatureId === featureId) setHovered(null);
        }}
      >
        <PendingGateBody
          gate={gate}
          gateKind={gateKind}
          isLoading={isLoading}
          isError={isError}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
          onRespond={respond}
          onOpenConversation={() => {
            setOpen(false);
            onOpenConversation();
          }}
        />
      </PopoverContent>
    </Popover>
  );
});

interface PendingGateBodyProps {
  gate: FeaturePendingGateResponse | undefined;
  gateKind: SessionGateKind | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  onRespond: (decision: FeatureGateDecision) => void;
  onOpenConversation: () => void;
}

function PendingGateBody({
  gate,
  gateKind,
  isLoading,
  isError,
  errorMessage,
  isSubmitting,
  onRespond,
  onOpenConversation,
}: PendingGateBodyProps): ReactElement {
  if (isLoading || (isSubmitting && !gate)) {
    return (
      <div className="flex flex-col gap-2.5 p-3.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (isError || !gate || !gateKind) {
    return (
      <div className="flex flex-col gap-2.5 p-3.5 text-xs">
        <p className="text-muted-foreground">{errorMessage ?? "No pending request found."}</p>
        <Button size="sm" variant="secondary" onClick={onOpenConversation}>
          Open conversation
        </Button>
      </div>
    );
  }

  if (gateKind === "plan") {
    return (
      <div className="flex flex-col gap-2.5 p-3.5 text-xs">
        <p className="font-medium text-foreground">Plan ready</p>
        {gate.last_assistant_text ? (
          <p className={cn("whitespace-pre-wrap text-muted-foreground", TEXT_SCROLL_CLASS)}>
            {gate.last_assistant_text}
          </p>
        ) : null}
        <Button size="sm" onClick={onOpenConversation}>
          Open conversation
        </Button>
      </div>
    );
  }

  return (
    <GateOptionsBody
      gate={gate}
      kind={gateKind}
      isSubmitting={isSubmitting}
      onRespond={onRespond}
      onOpenConversation={onOpenConversation}
    />
  );
}

function GateOptionsBody({
  gate,
  kind,
  isSubmitting,
  onRespond,
  onOpenConversation,
}: {
  gate: FeaturePendingGateResponse;
  kind: Exclude<SessionGateKind, "plan">;
  isSubmitting: boolean;
  onRespond: (decision: FeatureGateDecision) => void;
  onOpenConversation: () => void;
}): ReactElement {
  const { options, prompt } = useMemo(
    () => ({ options: buildOptions(gate), prompt: gatePrompt(gate) }),
    [gate],
  );
  const isPermission = kind === "permission";

  return (
    <div className="flex flex-col gap-2.5 p-3.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        {isPermission ? (
          <ShieldAlertIcon className="size-3.5 text-amber-400" />
        ) : (
          <MessageCircleQuestionIcon className="size-3.5 text-primary" />
        )}
        <span>{isPermission ? "Permission needed" : "Question"}</span>
        {isSubmitting ? (
          <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      {gate.last_assistant_text ? (
        <p
          className={cn(
            "whitespace-pre-wrap rounded-md px-2.5 py-2 text-[11px] leading-snug text-muted-foreground",
            isPermission ? "bg-amber-500/10" : "bg-muted/40",
            TEXT_SCROLL_CLASS,
          )}
        >
          {gate.last_assistant_text}
        </p>
      ) : null}
      {prompt ? (
        <p
          className={cn(
            "whitespace-pre-wrap leading-snug text-foreground",
            isPermission
              ? "rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 font-mono text-[11px]"
              : "font-medium",
            TEXT_SCROLL_CLASS,
          )}
        >
          {prompt}
        </p>
      ) : null}
      {options.length > 0 ? (
        <div className="flex max-h-[min(40vh,16rem)] flex-col gap-1.5 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={isSubmitting}
              className={cn(
                AGENT_OPTION_CARD_BASE,
                AGENT_OPTION_CARD_RESTING,
                "px-2.5 py-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-50",
                isPermission && "border-amber-500/20 hover:border-amber-500/40",
              )}
              onClick={() => onRespond(option.decision)}
            >
              <span className="block font-medium text-foreground">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={onOpenConversation}>
          Open conversation
        </Button>
      )}
    </div>
  );
}
