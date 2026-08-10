import {
  ExternalLinkIcon,
  GitCompareArrowsIcon,
  Loader2Icon,
  RefreshCwIcon,
  SendIcon,
  Settings2Icon,
} from "lucide-react";
import { memo, useCallback, useId, useState, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { CommentThread } from "@/api/generated";
import { PrViewError, relativeTime } from "@/components/FeaturePrViewParts";
import { ForgeAvatar } from "@/components/ForgeImage";
import { Markdown } from "@/components/Markdown";
import { PrCommentsFilterToggle, type PrCommentFilter } from "@/components/PrCommentsFilter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { openExternalUrl } from "@/lib/open-external";
import { isThreadAnchored, threadExternalHost, threadLocation } from "@/lib/pr-review-threads";
import { FORGE_SETTINGS_ANCHOR } from "@/lib/settings-anchors";
import { cn } from "@/lib/utils";

export interface PrCommentThreadProps {
  thread: CommentThread;
  selected?: boolean;
  /** Keyboard focus, which is not selection — j/k move it, `x` picks. */
  focused?: boolean;
  /**
   * Takes the thread id rather than closing over it, so the list can hand every
   * card one shared callback. Binding per card upstream produced a fresh arrow
   * for every row on every keystroke, which defeated this component's `memo`
   * exactly when `j`/`k` made it matter.
   */
  onSelectedChange?: (threadId: string, selected: boolean) => void;
  onViewThread?: (thread: CommentThread) => void;
  onSendThread?: (thread: CommentThread) => void;
}

/**
 * One review thread.
 *
 * Deliberately one surface rather than the header-band / body / footer-band
 * stack it replaced: three tinted strips inside a card inside a scroller read as
 * chrome, and the thread is the content. What is left is a location line, the
 * conversation, and the three things you can do about it.
 */
export const PrCommentThread = memo(function PrCommentThread({
  thread,
  selected = false,
  focused = false,
  onSelectedChange,
  onViewThread,
  onSendThread,
}: PrCommentThreadProps): ReactElement {
  const selectable = thread.resolved !== true && onSelectedChange != null;
  const threadId = thread.id;
  const handleSelectedChange = useCallback(
    (next: boolean): void => onSelectedChange?.(threadId, next),
    [onSelectedChange, threadId],
  );
  // No scroll-into-view here: the list owns revealing the focused row, and a
  // card that nudged itself as well raced it — the list would place a row the
  // virtualizer had just mounted, then the card would move it again.
  return (
    <article
      data-thread-id={thread.id}
      data-selected={selected || undefined}
      data-focused={focused || undefined}
      className={cn(
        // Gap below each card is the row wrapper's padding, not a margin here:
        // Virtuoso measures item wrappers with `getBoundingClientRect`, which
        // excludes margins, so a margin would leave the list short by one gap
        // per card — and the last card flush against the bottom edge.
        "mx-4 rounded-lg border bg-card px-3 py-2.5",
        "transition-[border-color,box-shadow,background-color] duration-150",
        selected ? "border-primary/60 bg-primary/[0.04]" : "border-border",
        focused && "ring-2 ring-ring/70",
        // A card the keyboard can land on needs a stable scroll anchor; a
        // thread taller than the viewport otherwise parks with its top clipped.
        "scroll-mt-2",
      )}
    >
      <ThreadStatusPills thread={thread} />
      {/*
        Fade the conversation only: putting opacity on the card also dimmed the
        status pill that says *why* the thread is settled (resolved → 2.5:1).
      */}
      <div
        className={cn(
          "space-y-2.5",
          (thread.outdated || thread.resolved != null) && "mt-1.5",
          thread.resolved && "opacity-70",
        )}
      >
        {thread.comments.map((comment, index) => (
          <div
            key={`${comment.created_at}:${index}`}
            className={cn(index > 0 && "border-t border-border/60 pt-2.5")}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <ForgeAvatar user={comment.author} />
              <span className="truncate font-medium text-foreground">
                {comment.author.display_name ?? comment.author.username}
              </span>
              <span className="shrink-0 tabular-nums">{relativeTime(comment.created_at)}</span>
              {index === 0 && (
                <ThreadPickControl
                  thread={thread}
                  selected={selected}
                  onSelectedChange={selectable ? handleSelectedChange : undefined}
                />
              )}
            </div>
            <Markdown
              content={comment.body_markdown}
              cacheKey={`${thread.id}:${comment.created_at}:${index}`}
              className="mt-1 max-w-prose text-[13px] leading-relaxed"
            />
          </div>
        ))}
      </div>
      <ThreadActions thread={thread} onViewThread={onViewThread} onSendThread={onSendThread} />
    </article>
  );
});

/** Outdated / open / resolved markers — kept off the author line so the pick control stays trailing. */
function ThreadStatusPills({ thread }: { thread: CommentThread }): ReactElement | null {
  if (!thread.outdated && thread.resolved == null) return null;
  return (
    <div className="flex items-center gap-1 text-[10.5px] font-medium">
      {/*
        Neutral pill, coloured dot — not coloured text on a tinted pill.
        A tint at these opacities pulls the surface *toward* the text's own hue,
        so it costs contrast rather than buying it: `--acc-orange` measures 4.45
        as a bare word on the light card and only 3.66 once tinted behind. The
        word rides `--muted`, where it clears 5:1 in every theme, and the dot
        carries the meaning — which is what the design system says colour is for
        anyway, and a dot is non-text, so 3:1 is the bar it has to clear.
      */}
      {thread.outdated && (
        <span
          className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
          title="The diff moved since this comment was written, so its line no longer points at the current code"
        >
          outdated
        </span>
      )}
      {thread.resolved != null && (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              thread.resolved ? "bg-[var(--acc-green)]" : "bg-[var(--acc-orange)]",
            )}
            aria-hidden
          />
          {thread.resolved ? "resolved" : "open"}
        </span>
      )}
    </div>
  );
}

/** Checkbox + location at the trailing end of the first comment's author line. */
function ThreadPickControl({
  thread,
  selected,
  onSelectedChange,
}: {
  thread: CommentThread;
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
}): ReactElement {
  const selectionId = useId();
  const location = threadLocation(thread);
  const context = location && thread.side === "old" ? `${location} (removed side)` : location;
  const label = (
    <span
      // Mono is for path:line; the "General comment" fallback stays proportional.
      className={cn("min-w-0 truncate text-[11px] text-muted-foreground", context && "font-mono")}
      title={context ?? undefined}
    >
      {context ?? "General comment"}
    </span>
  );
  if (!onSelectedChange) {
    return <span className="ml-auto min-w-0">{label}</span>;
  }
  return (
    <label
      htmlFor={selectionId}
      className="-my-1 ml-auto flex min-w-0 cursor-pointer items-center gap-2 py-1"
      title="Pick this thread for the agent"
    >
      <Checkbox
        id={selectionId}
        checked={selected}
        onCheckedChange={(checked) => onSelectedChange(checked === true)}
        aria-label={`Pick ${context ?? "this general comment"} for the agent`}
      />
      {label}
    </label>
  );
}

function ThreadActions({
  thread,
  onViewThread,
  onSendThread,
}: {
  thread: CommentThread;
  onViewThread?: (thread: CommentThread) => void;
  onSendThread?: (thread: CommentThread) => void;
}): ReactElement | null {
  const url = thread.comments.find((comment) => comment.url)?.url ?? null;
  const host = threadExternalHost(thread);
  const [opening, setOpening] = useState(false);
  const open = useCallback(async (): Promise<void> => {
    if (!url) return;
    setOpening(true);
    await openExternalUrl(url, "Could not open this review thread.");
    setOpening(false);
  }, [url]);
  const canView = !!onViewThread && isThreadAnchored(thread) && thread.resolved !== true;
  const canSend = !!onSendThread && thread.resolved !== true;
  if (!url && !canView && !canSend) return null;
  return (
    <div className="-mb-1 mt-1.5 flex flex-wrap items-center gap-0.5">
      {canSend && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onSendThread(thread)}
        >
          <SendIcon className="size-3" aria-hidden />
          Send to agent
        </Button>
      )}
      {canView && (
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onViewThread(thread)}
        >
          <GitCompareArrowsIcon className="size-3" aria-hidden />
          View in diff
        </Button>
      )}
      {url && (
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto text-muted-foreground hover:text-foreground"
          disabled={opening}
          onClick={() => void open()}
        >
          {opening ? (
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
          ) : (
            <ExternalLinkIcon className="size-3" aria-hidden />
          )}
          Reply on {host ?? "remote"}
        </Button>
      )}
    </div>
  );
}

export interface CommentsHeaderProps {
  commentsLoading: boolean;
  commentsRefreshing: boolean;
  commentsError: string | undefined;
  onRetry: () => void;
  /** Threads currently listed, i.e. after the filter is applied. */
  commentCount: number;
  unresolvedCount: number;
  totalCount: number;
  filter: PrCommentFilter;
  onFilterChange: (next: PrCommentFilter) => void;
  selectionEnabled?: boolean;
  selectedCount?: number;
  onAllSelectedChange?: (selected: boolean) => void;
}

/**
 * The threads section's one header row: what you are looking at, and the single
 * control that takes all of it. Everything the old version explained in prose —
 * what the checkbox column is for, where the send button lives, how many are
 * picked — is now said once, by the action bar that actually does it.
 */
export function CommentsHeader({
  commentsLoading,
  commentsRefreshing,
  commentsError,
  onRetry,
  commentCount,
  unresolvedCount,
  totalCount,
  filter,
  onFilterChange,
  selectionEnabled = false,
  selectedCount = 0,
  onAllSelectedChange,
}: CommentsHeaderProps): ReactElement {
  const showFilter = !commentsLoading && !commentsError && totalCount > 0;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h3 className="text-[12.5px] font-semibold tracking-tight">Review threads</h3>
        {commentsLoading && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            role="status"
          >
            <Loader2Icon className="size-3 animate-spin" aria-hidden /> Loading…
          </span>
        )}
        {/*
          One `ml-auto`, on the group: two of them as siblings share the free
          space between themselves, which left the filter stranded mid-row
          instead of grouped with the control it belongs beside.
        */}
        <div className="ml-auto flex items-center gap-2">
          {showFilter && (
            <PrCommentsFilterToggle
              value={filter}
              unresolvedCount={unresolvedCount}
              totalCount={totalCount}
              onChange={onFilterChange}
            />
          )}
          {selectionEnabled && onAllSelectedChange && (
            <SelectAllThreads
              unresolvedCount={unresolvedCount}
              selectedCount={selectedCount}
              onAllSelectedChange={onAllSelectedChange}
            />
          )}
        </div>
      </div>
      {commentsError && (
        <CommentsError
          message={commentsError}
          isRefreshing={commentsRefreshing}
          onRetry={onRetry}
        />
      )}
      {!commentsLoading && !commentsError && commentCount === 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          {totalCount === 0
            ? "No review threads yet."
            : "Nothing unresolved — every review thread on this proposal is resolved."}
        </p>
      )}
    </section>
  );
}

/**
 * Tri-state on purpose: after ticking a few threads by hand, a plain unchecked
 * box would read as "nothing picked".
 */
function SelectAllThreads({
  unresolvedCount,
  selectedCount,
  onAllSelectedChange,
}: {
  unresolvedCount: number;
  selectedCount: number;
  onAllSelectedChange: (selected: boolean) => void;
}): ReactElement {
  const selectAllId = useId();
  const allSelected = selectedCount === unresolvedCount;
  const checked: boolean | "indeterminate" = allSelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false;
  return (
    <label
      htmlFor={selectAllId}
      /* Foreground, not muted: this is a control's label, and `muted` on the
         dark card measures ~2.9:1 at this size. */
      className="-my-1 flex cursor-pointer items-center gap-2 py-1 text-[11.5px] text-foreground"
      title={allSelected ? "Clear every thread" : `Pick all ${unresolvedCount} unresolved threads`}
    >
      <Checkbox
        id={selectAllId}
        checked={checked}
        onCheckedChange={() => onAllSelectedChange(!allSelected)}
        aria-label={`Pick all ${unresolvedCount} unresolved threads for the agent`}
      />
      Pick all
    </label>
  );
}

function CommentsError({
  message,
  isRefreshing,
  onRetry,
}: {
  message: string;
  isRefreshing: boolean;
  onRetry: () => void;
}): ReactElement {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-56 flex-1">
        <PrViewError message={message} compact />
      </div>
      <Button variant="outline" size="xs" disabled={isRefreshing} onClick={onRetry}>
        {isRefreshing ? (
          <Loader2Icon className="size-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCwIcon className="size-3" aria-hidden />
        )}
        Retry
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() =>
          void navigate({ to: "/settings", search: { section: FORGE_SETTINGS_ANCHOR } })
        }
      >
        <Settings2Icon className="size-3" aria-hidden />
        Git settings
      </Button>
    </div>
  );
}
