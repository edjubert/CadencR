import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useDeleteFeatureBranch,
  useDeleteWorktree,
  useKillTerminalSessions,
  type Feature,
} from "@/api/generated";
import type { useArchiveCleanupState } from "@/components/archive-cleanup-state";
import type {
  ArchiveRelativeSelection,
  useArchiveRelativeOptions,
} from "@/components/ArchiveRelativeOptions";
import type { useKillTerminalsState } from "@/components/use-kill-terminals-state";
import { apiErrorMessage } from "@/lib/api-errors";

interface ConfirmationLock {
  isConfirming: boolean;
  lockConfirm: () => boolean;
  unlockConfirm: () => void;
}

interface ArchiveSubmissionArgs {
  open: boolean;
  feature: Feature | undefined;
  projectId: number;
  onArchive: (featureId: number, options: ArchiveRelativeSelection) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
  cleanupState: ReturnType<typeof useArchiveCleanupState>;
  killState: ReturnType<typeof useKillTerminalsState>;
  relativeState: ReturnType<typeof useArchiveRelativeOptions>;
  confirmationLock: ConfirmationLock;
}

export function useArchiveSubmission(args: ArchiveSubmissionArgs): {
  isConfirming: boolean;
  archiveError: unknown;
  confirm: () => void;
} {
  const [archiveError, setArchiveError] = useState<unknown>(null);
  const deleteWorktree = useDeleteWorktree();
  const deleteBranch = useDeleteFeatureBranch();
  const killTerminals = useKillTerminalSessions();
  useEffect(() => setArchiveError(null), [args.open, args.feature?.id]);
  const {
    feature,
    relativeState,
    cleanupState,
    killState,
    confirmationLock,
    onArchive,
    onOpenChange,
    projectId,
  } = args;

  const confirm = useCallback((): void => {
    if (
      !feature ||
      relativeState.isPending ||
      cleanupState.isCheckingBranch ||
      cleanupState.isCheckingWorktree ||
      !confirmationLock.lockConfirm()
    )
      return;
    const featureId = feature.id;
    const cleanup = {
      killTerminals: killState.killTerminals,
      removeWorktree: cleanupState.removeWorktree,
      removeBranch: cleanupState.removeBranch,
      forceBranchDelete: cleanupState.forceBranchDelete,
      forceWorktreeDelete: cleanupState.forceWorktreeDelete,
    };
    setArchiveError(null);
    void submitArchive({ onArchive, onOpenChange, projectId, relativeState }, featureId, cleanup, {
      deleteWorktree: deleteWorktree.mutateAsync,
      deleteBranch: deleteBranch.mutateAsync,
      killTerminals: killTerminals.mutateAsync,
      onError: (error) => {
        setArchiveError(error);
        confirmationLock.unlockConfirm();
      },
    });
  }, [
    cleanupState,
    confirmationLock,
    deleteBranch.mutateAsync,
    deleteWorktree.mutateAsync,
    feature,
    killTerminals.mutateAsync,
    killState.killTerminals,
    onArchive,
    onOpenChange,
    projectId,
    relativeState,
  ]);

  return useMemo(
    () => ({ isConfirming: confirmationLock.isConfirming, archiveError, confirm }),
    [confirmationLock.isConfirming, archiveError, confirm],
  );
}

type ArchiveExecutionArgs = Pick<
  ArchiveSubmissionArgs,
  "onArchive" | "onOpenChange" | "projectId" | "relativeState"
>;

async function submitArchive(
  args: ArchiveExecutionArgs,
  featureId: number,
  cleanup: CleanupSelection,
  actions: CleanupActions,
): Promise<void> {
  try {
    await args.onArchive(featureId, args.relativeState.selection);
  } catch (error) {
    actions.onError(error);
    return;
  }
  args.onOpenChange(false);
  if (!cleanup.killTerminals && !cleanup.removeWorktree && !cleanup.removeBranch) return;
  const cleanupPromise = performCleanup(args.projectId, featureId, cleanup, actions);
  toast.promise(cleanupPromise, {
    loading: "Session archived; cleaning up…",
    success: "Session archived and cleanup finished.",
    error: (error) => apiErrorMessage(error, "Session archived, but cleanup failed"),
  });
}

interface CleanupSelection {
  killTerminals: boolean;
  removeWorktree: boolean;
  removeBranch: boolean;
  forceBranchDelete: boolean;
  forceWorktreeDelete: boolean;
}

interface CleanupActions {
  deleteWorktree: ReturnType<typeof useDeleteWorktree>["mutateAsync"];
  deleteBranch: ReturnType<typeof useDeleteFeatureBranch>["mutateAsync"];
  killTerminals: ReturnType<typeof useKillTerminalSessions>["mutateAsync"];
  onError: (error: unknown) => void;
}

async function performCleanup(
  projectId: number,
  featureId: number,
  cleanup: CleanupSelection,
  actions: CleanupActions,
): Promise<void> {
  if (cleanup.killTerminals) {
    await actions.killTerminals({ params: { feature_id: featureId } });
  }
  await cleanupFeature({
    projectId,
    featureId,
    ...cleanup,
    deleteWorktree: actions.deleteWorktree,
    deleteBranch: actions.deleteBranch,
  });
}

async function cleanupFeature(args: {
  projectId: number;
  featureId: number;
  removeWorktree: boolean;
  removeBranch: boolean;
  forceBranchDelete: boolean;
  forceWorktreeDelete: boolean;
  deleteWorktree: CleanupActions["deleteWorktree"];
  deleteBranch: CleanupActions["deleteBranch"];
}): Promise<void> {
  const errors: string[] = [];
  const completed: string[] = [];
  if (args.removeWorktree) {
    try {
      const result = await args.deleteWorktree({
        params: {
          project_id: args.projectId,
          feature_id: args.featureId,
          force: args.forceWorktreeDelete,
        },
      });
      if (result.success) completed.push("worktree removal");
      else errors.push(result.error ?? "Failed to remove worktree");
    } catch (error) {
      errors.push(apiErrorMessage(error, "Failed to remove worktree"));
    }
  }
  if (args.removeBranch) {
    try {
      const result = await args.deleteBranch({
        params: {
          project_id: args.projectId,
          feature_id: args.featureId,
          force: args.forceBranchDelete,
        },
      });
      if (result.success) completed.push("branch deletion");
      else errors.push(result.error ?? "Failed to delete branch");
    } catch (error) {
      errors.push(apiErrorMessage(error, "Failed to delete branch"));
    }
  }
  if (errors.length > 0) {
    const partialSuccess = completed.length > 0 ? `; ${completed.join(" and ")} succeeded` : "";
    throw new Error(`${errors.join("; ")}${partialSuccess}`);
  }
}

export function useConfirmSubmissionLock(open: boolean): ConfirmationLock {
  const [isConfirming, setIsConfirming] = useState(false);
  const isConfirmingRef = useRef(false);
  useEffect(() => {
    if (open) return;
    isConfirmingRef.current = false;
    setIsConfirming(false);
  }, [open]);
  const lockConfirm = useCallback((): boolean => {
    if (isConfirmingRef.current) return false;
    isConfirmingRef.current = true;
    setIsConfirming(true);
    return true;
  }, []);
  const unlockConfirm = useCallback((): void => {
    isConfirmingRef.current = false;
    setIsConfirming(false);
  }, []);
  return useMemo(
    () => ({ isConfirming, lockConfirm, unlockConfirm }),
    [isConfirming, lockConfirm, unlockConfirm],
  );
}
