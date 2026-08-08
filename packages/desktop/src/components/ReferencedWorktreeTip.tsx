import { useCallback, useMemo, type ReactElement } from "react";
import { GitBranchIcon, Loader2Icon } from "lucide-react";
import { useListFeatureWorktrees, type FeatureWorktreeInfo } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { useScopedShortcut } from "@/hooks/useShortcut";
import { apiErrorMessage } from "@/lib/api-errors";
import type { ReferencedWorktreeSelection } from "./agent-prompt-bar-types";
import {
  parseConversationReferences,
  type ParsedConversationReference,
} from "./prompt-editor/conversation-reference";
import { ResolvedShortcutHint } from "./KbdShortcut";

interface ReferencedWorktreeTipProps {
  prompt: string;
  projectId: number;
  selection: ReferencedWorktreeSelection;
  agentTabActive: boolean;
  shortcutsDisabled: boolean;
}

interface ReferencedWorktree {
  branch: string;
  label: string;
  path: string;
}

function findReferencedWorktree(
  references: ParsedConversationReference[],
  worktrees: FeatureWorktreeInfo[] | undefined,
): ReferencedWorktree | null {
  if (!worktrees) return null;
  for (const reference of references) {
    const worktree = worktrees.find(
      (candidate) =>
        candidate.feature_id === reference.featureId &&
        candidate.live &&
        !candidate.is_main_worktree &&
        candidate.worktree_branch != null,
    );
    if (worktree?.worktree_branch) {
      return {
        branch: worktree.worktree_branch,
        label: reference.label,
        path: worktree.worktree_path,
      };
    }
  }
  return null;
}

export function ReferencedWorktreeTip({
  prompt,
  projectId,
  selection,
  agentTabActive,
  shortcutsDisabled,
}: ReferencedWorktreeTipProps): ReactElement | null {
  const references = useMemo(() => parseConversationReferences(prompt), [prompt]);
  const enabled = references.length > 0;
  const worktreesQuery = useListFeatureWorktrees({ project_id: projectId }, { query: { enabled } });
  const worktree = useMemo(
    () => findReferencedWorktree(references, worktreesQuery.data),
    [references, worktreesQuery.data],
  );
  const alreadySelected =
    worktree != null &&
    selection.mode === "branch_worktree" &&
    selection.selectedBranch === worktree.branch;
  const useWorktree = useCallback((): void => {
    if (worktree) selection.onSelect(worktree.branch);
  }, [selection, worktree]);
  const shortcutOptions = useMemo(
    () => ({
      enabled:
        enabled && worktree != null && agentTabActive && !shortcutsDisabled && !alreadySelected,
      preventDefault: true,
    }),
    [agentTabActive, alreadySelected, enabled, shortcutsDisabled, worktree],
  );

  useScopedShortcut(
    "agent-use-referenced-worktree",
    (event) => {
      if (!worktree || alreadySelected) return;
      event.preventDefault();
      useWorktree();
    },
    "agent",
    shortcutOptions,
  );

  if (!enabled || alreadySelected) return null;
  if (worktreesQuery.isLoading) {
    return (
      <div
        className="mb-2 flex h-8 items-center gap-2 px-1 text-[11px] text-muted-foreground"
        role="status"
      >
        <Loader2Icon className="size-3.5 animate-spin" />
        Checking the referenced conversation for a worktree…
      </div>
    );
  }
  if (worktreesQuery.isError) {
    return (
      <p className="mb-2 px-1 text-[11px] text-destructive" role="status">
        {apiErrorMessage(worktreesQuery.error, "Could not check the referenced worktree.")}
      </p>
    );
  }
  if (!worktree) return null;

  const ariaLabel = `Reuse ${worktree.branch} worktree from ${worktree.label} when you send`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={useWorktree}
      title={`Reuse ${worktree.path} when you send your first message`}
      aria-label={ariaLabel}
      // `--primary`, not the `--chip-worktree-*` trio: those tokens tone the
      // *state* chips that report which worktree a session is on, while this row
      // is a call to action attached to the send you are about to make. It reads
      // as the theme's action color — same one the send button carries.
      className="mb-2 w-full min-w-0 justify-start border-primary/30 bg-primary/10 px-2.5 text-left text-[11px] text-primary shadow-sm hover:bg-primary/15 hover:text-primary focus-visible:ring-primary/40"
    >
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Reuse <span className="font-mono">{worktree.branch}</span> from {worktree.label} when you
        send
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] opacity-90">
        Reuse worktree
        <ResolvedShortcutHint shortcutId="agent-use-referenced-worktree" />
      </span>
    </Button>
  );
}
