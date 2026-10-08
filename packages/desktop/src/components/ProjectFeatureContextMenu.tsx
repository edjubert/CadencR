import type { ReactNode } from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  FolderGit2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  PinIcon,
  PinOffIcon,
  TagIcon,
  TrashIcon,
  TypeIcon,
  XIcon,
} from "lucide-react";
import { ContextMenuSeparator } from "@/components/ui/context-menu";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";
import type { Feature, FeatureWorktreeInfo, PrSummary } from "@/api/generated";
import { closeFeatureActivityNoun } from "@/lib/feature-activity-close";
import { copyToClipboard } from "@/lib/clipboard";
import { openPullRequestActionLabel, openPullRequestExternally } from "@/lib/open-pull-request";
import { archiveActionLabel, pinActionLabel } from "@/components/ProjectFeatureRowParts";

interface ProjectFeatureContextMenuProps {
  feature: Feature;
  liveTitle: string | undefined;
  worktree: FeatureWorktreeInfo | undefined;
  /** Open proposal on the feature's branch, when the forge poller found one. */
  pullRequest: PrSummary | null | undefined;
  isArchived: boolean;
  isPinned: boolean;
  hasActivity: boolean;
  shellCount: number;
  browserCount: number;
  downloadCount: number;
  onNavigate: (feature: Feature) => void;
  onTogglePin: (featureId: number, pinned: boolean) => void;
  onStartLabelEditAfterMenuClose: () => void;
  onCloseActivity: (
    featureId: number,
    shellCount: number,
    browserCount: number,
    downloadCount: number,
  ) => void;
  onUnarchive: (featureId: number) => void;
  onArchiveOrDelete: (featureId: number) => void;
}

export function ProjectFeatureContextMenu({
  feature,
  liveTitle,
  worktree,
  pullRequest,
  isArchived,
  isPinned,
  hasActivity,
  shellCount,
  browserCount,
  downloadCount,
  onNavigate,
  onTogglePin,
  onStartLabelEditAfterMenuClose,
  onCloseActivity,
  onUnarchive,
  onArchiveOrDelete,
}: ProjectFeatureContextMenuProps): ReactNode {
  const featureTitle = liveTitle ?? feature.title;
  const branch = worktree?.worktree_branch ?? "";
  const worktreePath = worktree?.worktree_path ?? "";
  return (
    <>
      <ContextMenuActionItem icon={ArrowRightIcon} onSelect={() => onNavigate(feature)}>
        Open
      </ContextMenuActionItem>
      {!isArchived && (
        <ContextMenuActionItem
          icon={isPinned ? PinOffIcon : PinIcon}
          onSelect={() => onTogglePin(feature.id, !isPinned)}
        >
          {pinActionLabel(isPinned)}
        </ContextMenuActionItem>
      )}
      <ContextMenuActionItem icon={TagIcon} onSelect={onStartLabelEditAfterMenuClose}>
        Set label
      </ContextMenuActionItem>
      {hasActivity && (
        <ContextMenuActionItem
          icon={XIcon}
          onSelect={() => onCloseActivity(feature.id, shellCount, browserCount, downloadCount)}
        >
          {`Close ${closeFeatureActivityNoun(shellCount, browserCount, downloadCount)}`}
        </ContextMenuActionItem>
      )}
      <ContextMenuSeparator />
      {pullRequest && (
        <ContextMenuActionItem
          icon={GitPullRequestIcon}
          onSelect={() => void openPullRequestExternally(pullRequest)}
        >
          {`${openPullRequestActionLabel(pullRequest)} #${pullRequest.number}`}
        </ContextMenuActionItem>
      )}
      <ContextMenuActionItem
        icon={GitBranchIcon}
        disabled={!branch}
        onSelect={() => void copyToClipboard(branch, "Branch copied")}
      >
        Copy branch
      </ContextMenuActionItem>
      <ContextMenuActionItem
        icon={FolderGit2Icon}
        disabled={!worktreePath}
        onSelect={() => void copyToClipboard(worktreePath, "Worktree path copied")}
      >
        Copy worktree path
      </ContextMenuActionItem>
      <ContextMenuActionItem
        icon={TypeIcon}
        disabled={!featureTitle}
        onSelect={() => void copyToClipboard(featureTitle, "Feature title copied")}
      >
        Copy feature title
      </ContextMenuActionItem>
      <ContextMenuSeparator />
      {isArchived && (
        <ContextMenuActionItem icon={ArchiveRestoreIcon} onSelect={() => onUnarchive(feature.id)}>
          Unarchive
        </ContextMenuActionItem>
      )}
      <ContextMenuActionItem
        icon={isArchived ? TrashIcon : ArchiveIcon}
        variant="destructive"
        onSelect={() => onArchiveOrDelete(feature.id)}
      >
        {archiveActionLabel(isArchived)}
      </ContextMenuActionItem>
    </>
  );
}
