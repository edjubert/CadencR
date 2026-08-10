import { memo, useMemo, type ReactElement } from "react";

import { BranchChip } from "@/components/branch-chip/BranchChip";
import { GitActionPopover, type GitUpdateRecoveryControls } from "./GitActionPopover";
import type { GitAction, GitActionState, GitActivities } from "./useGitAction";
import { useGitUpdateRecoveryActions } from "./useGitUpdateRecoveryActions";

interface GitActionPopoverContentProps {
  featureId: number;
  projectId: number;
  state: GitActionState;
  activities?: GitActivities;
  onPick: (action: GitAction) => void;
}

export const GitActionPopoverContent = memo(function GitActionPopoverContent(
  props: GitActionPopoverContentProps,
): ReactElement {
  return (
    <>
      <div className="border-b border-border px-3 py-2">
        <BranchChip featureId={props.featureId} projectId={props.projectId} />
      </div>
      <RecoveryAwareGitActionPopover {...props} />
    </>
  );
});

function RecoveryAwareGitActionPopover(props: GitActionPopoverContentProps): ReactElement {
  if (!props.state.recovery) {
    return (
      <GitActionPopover state={props.state} activities={props.activities} onPick={props.onPick} />
    );
  }
  return <GitActionRecoveryPopover {...props} recovery={props.state.recovery} />;
}

function GitActionRecoveryPopover({
  featureId,
  state,
  activities,
  onPick,
  recovery,
}: GitActionPopoverContentProps & {
  recovery: NonNullable<GitActionState["recovery"]>;
}): ReactElement {
  const actions = useGitUpdateRecoveryActions({
    featureId,
    operation: recovery.operation,
    conflictCount: recovery.conflictCount,
  });
  const recoveryControls = useMemo<GitUpdateRecoveryControls>(
    () => ({
      pendingAction: actions.pendingAction,
      error: actions.error,
      onContinue: actions.continueUpdate,
      onAbort: actions.abortUpdate,
    }),
    [actions.abortUpdate, actions.continueUpdate, actions.error, actions.pendingAction],
  );
  return (
    <GitActionPopover
      state={state}
      activities={activities}
      onPick={onPick}
      recoveryControls={recoveryControls}
    />
  );
}
