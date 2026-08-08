import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useState, type ReactElement, type ReactNode, type WheelEvent } from "react";
import type { CiCheck, CiState, PrStatusSnapshot, ReviewState } from "@/api/generated";
import { relativeTime } from "@/components/FeaturePrViewParts";
import { ForgeAvatar } from "@/components/ForgeImage";
import {
  PR_TONE_DOT,
  prIndicatorTone,
  type PrIndicatorTone,
} from "@/components/PrStatusIndicators";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { openExternalUrl } from "@/lib/open-external";
import { openPullRequestExternally } from "@/lib/open-pull-request";
import { cn } from "@/lib/utils";

const CI_STATE_LABEL: Record<CiState, string> = {
  none: "none",
  running: "running",
  passing: "passing",
  failing: "failing",
};

const CI_STATE_TEXT: Record<CiState, string> = {
  none: "text-muted-foreground",
  running: "text-[var(--acc-orange)]",
  passing: "text-[var(--acc-green)]",
  failing: "text-[var(--acc-red)]",
};

const FACT_TONE: Record<PrIndicatorTone, string> = {
  blocked: "text-[var(--acc-orange)] ring-[var(--acc-orange)]/30",
  danger: "text-[var(--acc-red)] ring-[var(--acc-red)]/30",
  merged: "text-[var(--acc-green)] ring-[var(--acc-green)]/30",
  neutral: "text-muted-foreground ring-border",
  ready: "text-[var(--acc-cyan)] ring-[var(--acc-cyan)]/30",
  unresolved: "text-[var(--acc-yellow)] ring-[var(--acc-yellow)]/30",
};

function reviewTone(reviewState: ReviewState): PrIndicatorTone {
  if (reviewState === "changes_requested" || reviewState === "pending") return "blocked";
  if (reviewState === "approved") return "ready";
  return "neutral";
}

export function reviewStateLabel(reviewState: ReviewState): string | null {
  if (reviewState === "none") return null;
  if (reviewState === "changes_requested") return "changes requested";
  if (reviewState === "pending") return "review pending";
  return "approved";
}

export interface PrStatusBandProps {
  status: PrStatusSnapshot;
  unresolvedCount: number;
  /** True while the unresolved-only filter is the one in force. */
  unresolvedFiltered: boolean;
  onToggleUnresolved: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Forwards a wheel gesture over this unscrollable band to the list below. */
  onWheel?: (event: WheelEvent<HTMLDivElement>) => void;
}

/**
 * Everything that must stay legible while you read the fortieth comment: which
 * proposal this is, and whether anything is blocking it.
 *
 * The old band buried CI inside an accordion that folded itself as you
 * scrolled, so "is it green?" cost a click and an animation. Here the verdict
 * is the row of facts — each one a real control, not a label — and the check
 * list is what opens underneath when you want to know *which* one broke.
 */
export function PrStatusBand({
  status,
  unresolvedCount,
  unresolvedFiltered,
  onToggleUnresolved,
  onRefresh,
  isRefreshing,
  onWheel,
}: PrStatusBandProps): ReactElement {
  const pr = status.pr!;
  // `@container`: the identity line drops its separators and its branch pair by
  // the width of the band itself. Safe as a containment context here — every
  // overlay under this subtree (tooltips, menus) is portaled out.
  return (
    <div className="@container shrink-0 border-b border-border bg-card/40" onWheel={onWheel}>
      <div className="space-y-2 px-4 pb-2.5 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            {/* Clamped: a long title wrapped to four lines in a narrow pane and
                pushed every review thread off-screen before one was readable. */}
            <h2
              className="line-clamp-2 text-[15px] font-semibold leading-snug text-balance text-foreground"
              title={pr.title}
            >
              {pr.title}
            </h2>
            <PrIdentityLine status={status} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
            <OpenProposalButton status={status} />
          </div>
        </div>
      </div>
      <ChecksDisclosure
        status={status}
        unresolvedCount={unresolvedCount}
        unresolvedFiltered={unresolvedFiltered}
        onToggleUnresolved={onToggleUnresolved}
      />
    </div>
  );
}

/**
 * Number, state, author, branches, freshness — one line of provenance.
 *
 * Each fact travels with its own leading separator inside a non-wrapping
 * segment, and the separators disappear entirely once the band is too narrow
 * to hold the line: a wrapped row used to strand its dots at the ends of lines
 * ("Raphael Le Minor ·"), which reads as truncation rather than punctuation.
 * The branch pair drops at the same width — it is the one fact the tab strip
 * and the title already imply, and it keeps its `title` either way.
 */
function PrIdentityLine({ status }: { status: PrStatusSnapshot }): ReactElement {
  const pr = status.pr!;
  const branches = `${pr.source_branch} → ${pr.target_branch}`;
  const author = pr.author.display_name ?? pr.author.username;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums text-foreground">
        <span
          className={cn("size-1.5 rounded-full", PR_TONE_DOT[prIndicatorTone(status)])}
          aria-hidden
        />
        #{pr.number}
      </span>
      <span className="shrink-0 capitalize">{pr.state}</span>
      <Segment>
        <ForgeAvatar user={pr.author} />
        <span className="max-w-40 truncate">{author}</span>
      </Segment>
      <Segment className="@max-[24rem]:hidden" title={branches}>
        <span className="min-w-0 truncate font-mono">{pr.source_branch}</span>
        <span aria-hidden className="shrink-0 font-mono">
          →
        </span>
        <span className="shrink-0 font-mono">{pr.target_branch}</span>
      </Segment>
      <Segment>
        <span className="tabular-nums">{relativeTime(pr.updated_at)}</span>
      </Segment>
    </div>
  );
}

function Segment({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}): ReactElement {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} title={title}>
      <span aria-hidden className="shrink-0 text-border @max-[24rem]:hidden">
        ·
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5">{children}</span>
    </span>
  );
}

function RefreshButton({
  onRefresh,
  isRefreshing,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={isRefreshing}
      onClick={onRefresh}
      aria-label="Refresh from the forge"
      title="Refresh from the forge"
    >
      <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} aria-hidden />
    </Button>
  );
}

function OpenProposalButton({ status }: { status: PrStatusSnapshot }): ReactElement {
  const pr = status.pr!;
  const [opening, setOpening] = useState(false);
  const handleOpen = useCallback(async (): Promise<void> => {
    setOpening(true);
    await openPullRequestExternally(pr);
    setOpening(false);
  }, [pr]);
  return (
    <Button variant="outline" size="sm" disabled={opening} onClick={() => void handleOpen()}>
      {opening ? (
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <ExternalLinkIcon className="size-3.5" aria-hidden />
      )}
      Open
    </Button>
  );
}

/**
 * The verdict row, plus the check list it opens.
 *
 * Default-open on a failing run only: that is the one state where the summary
 * ("2 failing") is never the answer you wanted — you came for the name of the
 * job. Everything else stays folded so the band stays a band.
 */
function ChecksDisclosure({
  status,
  unresolvedCount,
  unresolvedFiltered,
  onToggleUnresolved,
}: {
  status: PrStatusSnapshot;
  unresolvedCount: number;
  unresolvedFiltered: boolean;
  onToggleUnresolved: () => void;
}): ReactElement {
  const ciState = status.ci?.state ?? "none";
  const checks = status.ci?.checks ?? [];
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? ciState === "failing";
  const reviewLabel = reviewStateLabel(status.pr!.review_state);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2.5">
        {checks.length > 0 && (
          <Fact
            tone={ciTone(ciState)}
            icon={<CiStateIcon state={ciState} />}
            expanded={open}
            onClick={() => setOverride(!open)}
          >
            {checkSummary(ciState, checks)}
          </Fact>
        )}
        {unresolvedCount > 0 && (
          <Fact
            tone="unresolved"
            icon={<MessageSquareIcon className="size-3.5 shrink-0" aria-hidden />}
            pressed={unresolvedFiltered}
            onClick={onToggleUnresolved}
          >
            {unresolvedCount} unresolved
          </Fact>
        )}
        {reviewLabel && <Fact tone={reviewTone(status.pr!.review_state)}>{reviewLabel}</Fact>}
        {checks.length === 0 && unresolvedCount === 0 && !reviewLabel && (
          <span className="text-[11.5px] text-muted-foreground">
            Nothing reported yet — no checks, no reviews, no open threads.
          </span>
        )}
      </div>
      <CollapsibleSection open={open && checks.length > 0}>
        {/*
          The cap has to land mid-row for a long run, and a row sheared flat by
          an invisible edge reads as a rendering fault rather than "scroll for
          more". The mask fades the last few pixels so the cut is legible as a
          cut; `pb-4` is what makes it free when the list fits — the fade then
          lands on empty padding and nothing looks any different.
        */}
        <div
          className={cn(
            // Shorter cap in a narrow pane: auto-opening a failing run was
            // taking the pinned band to 54% of the pane before one review
            // thread was reachable. Wide, the list is worth the room.
            "max-h-40 @max-[24rem]:max-h-24",
            "overflow-y-auto border-t border-border/70 px-2 pb-4 pt-1.5",
            "[mask-image:linear-gradient(to_bottom,black_calc(100%-1rem),transparent)]",
          )}
        >
          {byUrgency(checks).map((check) => (
            <CiCheckRow key={check.name} check={check} />
          ))}
        </div>
      </CollapsibleSection>
    </>
  );
}

const CHECK_URGENCY: Record<CiState, number> = { failing: 0, running: 1, none: 2, passing: 3 };

/**
 * Broken first, then still-running. The list is capped and scrolls inside a
 * pinned band, so whichever jobs land in the first few rows are the ones most
 * people will ever read — and on a repo with thirty green checks, alphabetical
 * order buries the single red one below the fold.
 */
function byUrgency(checks: readonly CiCheck[]): CiCheck[] {
  return [...checks].sort((left, right) => CHECK_URGENCY[left.state] - CHECK_URGENCY[right.state]);
}

function ciTone(state: CiState): PrIndicatorTone {
  if (state === "failing") return "danger";
  if (state === "passing") return "merged";
  if (state === "running") return "blocked";
  return "neutral";
}

/**
 * What the run actually says. The rollup state is one word for the whole set,
 * so pairing it with the set's size reads as a lie — "6 checks failing" when
 * one job broke. The failing and running counts are the numbers a developer is
 * asking for; the total is context, not the headline.
 */
function checkSummary(state: CiState, checks: readonly CiCheck[]): string {
  const total = checks.length;
  const failing = checks.filter((check) => check.state === "failing").length;
  if (failing > 0) return `${failing} of ${total} failing`;
  const running = checks.filter((check) => check.state === "running").length;
  if (running > 0) return `${running} of ${total} running`;
  if (state === "passing") return `${total} ${total === 1 ? "check" : "checks"} passing`;
  return `${total} ${total === 1 ? "check" : "checks"}`;
}

/**
 * One statement about the proposal. Interactive whenever there is something
 * behind it — the whole point of the row is that the answer to "what is
 * blocking this" is also the way to go look at it.
 */
function Fact({
  tone,
  icon,
  children,
  onClick,
  expanded,
  pressed,
}: {
  tone: PrIndicatorTone;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  pressed?: boolean;
}): ReactElement {
  const shell = cn(
    "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium ring-1 ring-inset",
    FACT_TONE[tone],
  );
  if (!onClick) {
    return (
      <span className={shell}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-pressed={pressed}
      className={cn(
        shell,
        "transition-colors hover:bg-accent/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "bg-accent/60",
      )}
    >
      {icon}
      {children}
      {expanded != null && (
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 transition-transform duration-150",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      )}
    </button>
  );
}

function CiCheckRow({ check }: { check: CiCheck }): ReactElement {
  const [opening, setOpening] = useState(false);
  const handleOpen = useCallback(async (): Promise<void> => {
    if (!check.url) return;
    setOpening(true);
    await openExternalUrl(check.url, "Could not open check.");
    setOpening(false);
  }, [check.url]);
  const rowClass = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]";
  const content = (
    <>
      <span className={cn("inline-flex", CI_STATE_TEXT[check.state])}>
        <CiStateIcon state={check.state} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={check.name}>
        {check.name}
      </span>
      <span className={cn("shrink-0 text-[11px] capitalize", CI_STATE_TEXT[check.state])}>
        {CI_STATE_LABEL[check.state]}
      </span>
    </>
  );
  if (!check.url) return <div className={rowClass}>{content}</div>;
  return (
    <button
      type="button"
      className={cn(rowClass, "transition-colors hover:bg-accent/60 disabled:opacity-60")}
      disabled={opening}
      onClick={() => void handleOpen()}
    >
      {content}
      {opening ? (
        <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

function CiStateIcon({ state }: { state: CiState }): ReactElement {
  if (state === "passing") return <CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden />;
  if (state === "failing") return <XCircleIcon className="size-3.5 shrink-0" aria-hidden />;
  if (state === "running")
    return <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden />;
  return <CircleDashedIcon className="size-3.5 shrink-0" aria-hidden />;
}
