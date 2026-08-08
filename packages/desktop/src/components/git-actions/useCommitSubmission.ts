import { useCallback } from "react";
import { type CommitBody, useCommit } from "@/api/generated";
import { selectCommitStatus, useCommitOutputStore } from "@/stores/useCommitOutputStore";
import {
  useGitOutputSubmission,
  type GitOutputSubmissionController,
  type GitOutputSubmissionCopy,
} from "./useGitOutputSubmission";

interface UseCommitSubmissionOptions {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export type CommitSubmissionController = GitOutputSubmissionController<CommitBody>;

const COMMIT_COPY: GitOutputSubmissionCopy = {
  failure: "Commit failed",
  failureHint: "Open the commit output to inspect the pre-commit error.",
  success: "Committed",
  backgroundSuccess: "Background commit completed",
};

export function useCommitSubmission({
  featureId,
  open,
  onOpenChange,
}: UseCommitSubmissionOptions): CommitSubmissionController {
  const commit = useCommit();
  const run = useCallback((body: CommitBody) => commit.mutateAsync({ data: body }), [commit]);

  return useGitOutputSubmission<CommitBody>({
    featureId,
    open,
    onOpenChange,
    useStore: useCommitOutputStore,
    selectStatus: selectCommitStatus,
    isPending: commit.isPending,
    run,
    copy: COMMIT_COPY,
  });
}
