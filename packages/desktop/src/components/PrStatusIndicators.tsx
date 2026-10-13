import { GitPullRequestIcon } from "lucide-react";
import type { PrStatusSnapshot, PrSummary } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { cn } from "@/lib/utils";

export type PrIndicatorTone = "blocked" | "danger" | "merged" | "neutral" | "ready" | "unresolved";

/**
 * Every tone resolves through a theme token. `ready` used to be a raw Tailwind
 * `blue-400`, which is the one hue in these maps that no theme gets to tune —
 * on the light grounds it lands around 2.3:1, well under the 4.5:1 these
 * 10.5px chips need. `--acc-cyan` is the same idea in a colour each theme
 * already picked for its own background (`#52bfd0` dark, `#007f9b` light).
 */

const PR_ICON_STYLE: Record<PrIndicatorTone, string> = {
  blocked: "text-[var(--acc-orange)]",
  danger: "text-[var(--acc-red)]",
  merged: "text-[var(--acc-green)]",
  neutral: "text-muted-foreground",
  ready: "text-[var(--acc-cyan)]",
  unresolved: "text-[var(--acc-yellow)]",
};

/**
 * Tone lives in the border and the glyph; the surface stays neutral.
 *
 * These used to carry a 10% wash of their own hue, which reads as a nice tint
 * and quietly costs the thing it sits behind: a wash pulls the background
 * *toward* the text colour, so the 10.5px number on it lost roughly a point of
 * contrast in every tone — `ready` measured 3.62 against a 4.5 bar on the light
 * grounds. `bg-background/50` is what `neutral` already used; the other five
 * now agree with it, and the coloured border still names the state.
 */
const PR_CHIP_SURFACE: Record<PrIndicatorTone, string> = {
  blocked: "border-[var(--acc-orange)]/40 bg-background/50",
  danger: "border-[var(--acc-red)]/40 bg-background/50",
  merged: "border-[var(--acc-green)]/40 bg-background/50",
  neutral: "border-border/70 bg-background/50",
  ready: "border-[var(--acc-cyan)]/40 bg-background/50",
  unresolved: "border-[var(--acc-yellow)]/40 bg-background/50",
};

/**
 * Fill classes for the solid dot that carries proposal health where there is no
 * room for words — the Git sub-tab strip. Same tones as the chip, as a fill
 * rather than a tint, because a 6px dot at 10% opacity reads as nothing.
 */
export const PR_TONE_DOT: Record<PrIndicatorTone, string> = {
  blocked: "bg-[var(--acc-orange)]",
  danger: "bg-[var(--acc-red)]",
  merged: "bg-[var(--acc-green)]",
  neutral: "bg-muted-foreground",
  ready: "bg-[var(--acc-cyan)]",
  unresolved: "bg-[var(--acc-yellow)]",
};

export function prIndicatorTone(snapshot: PrStatusSnapshot | undefined): PrIndicatorTone {
  const pr = snapshot?.pr;
  if (!pr) return "neutral";
  if (pr.state === "merged") return "merged";
  if (pr.state === "closed") return "neutral";
  // Red outranks orange: a failing check run is the one thing the user has to
  // act on, and "awaiting review" is the most common state to be in while it
  // fails. The sidebar has no second slot left to say it in.
  if (snapshot.error || snapshot.ci?.state === "failing") return "danger";
  // A draft is still being written, so unanswered feedback on it is expected
  // rather than a call to action.
  if (pr.state === "draft") return "blocked";
  // Yellow is the "the machines are happy, the humans are not" state: green
  // checks used to read as ready-to-merge blue even with reviewers still
  // waiting on replies, which is the one case where the chip actively misled.
  // `unresolved_threads` is undefined when the poller never looked — unknown,
  // not zero — so an absent count correctly falls through to the checks.
  if (snapshot.ci?.state === "passing" && (snapshot.unresolved_threads ?? 0) > 0) {
    return "unresolved";
  }
  if (
    pr.review_state === "changes_requested" ||
    pr.review_state === "pending" ||
    snapshot.ci?.state === "running"
  ) {
    return "blocked";
  }
  return "ready";
}

export function prStatusLabel(snapshot: PrStatusSnapshot): string {
  const pr = snapshot.pr!;
  const details: string[] = [];
  if (pr.state === "merged") details.push("merged");
  else if (pr.state === "draft") details.push("draft");
  else if (pr.state === "closed") details.push("closed");

  if (pr.review_state === "approved") details.push("approved");
  else if (pr.review_state === "changes_requested") details.push("changes requested");
  else if (pr.review_state === "pending") details.push("review pending");

  if (snapshot.ci && snapshot.ci.state !== "none") {
    details.push(`checks ${snapshot.ci.state}`);
  }
  const unresolved = snapshot.unresolved_threads ?? 0;
  if (unresolved > 0) {
    details.push(`${unresolved} unresolved ${unresolved === 1 ? "thread" : "threads"}`);
  }
  if (details.length === 0) details.push("no blockers reported");
  return `${pr.pr_label} #${pr.number} · ${details.join(" · ")}`;
}

/**
 * The sidebar row's forge slot. Normally the proposal chip; when a host lookup
 * failed before any proposal was found there is no chip to tint, so the error
 * still surfaces as a dot rather than disappearing.
 *
 * A forge that was never connected is not one of those failures and gets no dot:
 * on a fresh install every row would carry one, which is noise rather than news
 * — the same reason the poller stays quiet about a feature with no remote. The
 * PR pane is where that state is worth a word, and there it comes with a button.
 */
export function FeaturePrIndicator({
  snapshot,
}: {
  snapshot: PrStatusSnapshot | undefined;
}): React.JSX.Element | null {
  if (!snapshot?.pr) {
    if (!snapshot?.error || snapshot.setup_required) return null;
    return (
      <span
        data-feature-pr
        className="size-1.5 shrink-0 rounded-full bg-[var(--acc-red)] ring-1 ring-background"
        aria-label={`Forge status error: ${snapshot.error}`}
        title={snapshot.error}
      />
    );
  }
  return <FeaturePrChip snapshot={snapshot} pr={snapshot.pr} />;
}

function FeaturePrChip({
  snapshot,
  pr,
}: {
  snapshot: PrStatusSnapshot;
  pr: PrSummary;
}): React.JSX.Element {
  const label = prStatusLabel(snapshot);
  const tone = prIndicatorTone(snapshot);
  const running = snapshot.ci?.state === "running";
  return (
    <ShortcutTooltip label={label} toRight className="shrink-0">
      <span
        data-feature-pr
        className={cn(
          "inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono text-[10.5px] font-medium leading-none tabular-nums",
          PR_CHIP_SURFACE[tone],
          PR_ICON_STYLE[tone],
          // A live check run is the one state worth a halo, and it breathes so
          // it reads as "still working". Settled verdicts stay flat.
          running && "pr-chip-checks-running",
        )}
        aria-label={label}
      >
        <GitPullRequestIcon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{pr.number}</span>
      </span>
    </ShortcutTooltip>
  );
}
