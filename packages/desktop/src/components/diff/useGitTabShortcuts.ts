import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import { shouldIgnoreGitShortcut } from "@/lib/shortcuts/git-shortcut-guards";
import type { ShortcutId } from "@/lib/shortcuts/registry";

type GitTabShortcutId = Extract<
  ShortcutId,
  | "diff-toggle-sidebar"
  | "diff-send-comments"
  | "diff-send-review-comments"
  | "git-previous-review-thread"
  | "git-next-review-thread"
>;

function useGitTabCommand(id: GitTabShortcutId, action: () => void, enabled: boolean): void {
  useScopedGlobalShortcutById(
    id,
    (event) => {
      if (event.repeat || shouldIgnoreGitShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action();
    },
    "git",
    { enabled },
  );
}

export interface GitTabShortcutTargets {
  enabled: boolean;
  toggleFileList: () => void;
  isFileListCollapseLoading: boolean;
  /** True on the list views, which render no file list to collapse. */
  isListView: boolean;
  /** True on the PR view, which has no local drafts to send. */
  isPr: boolean;
  sendDrafts: () => void;
  sendReviewThreads: () => void;
  canSendReviewThreads: boolean;
  previousReview: () => void;
  nextReview: () => void;
  canNavigateReviews: boolean;
}

/**
 * The Git tab's scoped review and diff bindings.
 *
 * `diff-send-comments` is deliberately contextual rather than two separate
 * bindings: the active view already tells you which body of feedback "send" can
 * possibly mean, so one key keeps the muscle memory intact across views.
 */
export function useGitTabShortcuts({
  enabled,
  toggleFileList,
  isFileListCollapseLoading,
  isListView,
  isPr,
  sendDrafts,
  sendReviewThreads,
  canSendReviewThreads,
  previousReview,
  nextReview,
  canNavigateReviews,
}: GitTabShortcutTargets): void {
  useGitTabCommand(
    "diff-toggle-sidebar",
    toggleFileList,
    enabled && !isListView && !isFileListCollapseLoading,
  );

  useGitTabCommand(
    "diff-send-comments",
    () => {
      if (isPr) sendReviewThreads();
      else sendDrafts();
    },
    enabled,
  );

  useGitTabCommand("diff-send-review-comments", sendReviewThreads, enabled && canSendReviewThreads);

  useGitTabCommand("git-previous-review-thread", previousReview, enabled && canNavigateReviews);

  useGitTabCommand("git-next-review-thread", nextReview, enabled && canNavigateReviews);
}
