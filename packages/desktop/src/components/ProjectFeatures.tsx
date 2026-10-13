import { useRef, useState } from "react";
import { ArchiveFeatureDialog } from "@/components/ArchiveFeatureDialog";
import { ArchivedFeatureList, ArchivedFeatureSection } from "@/components/ArchivedFeatureList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  useProjectFeaturesController,
  type ProjectFeaturesController,
  type ProjectFeaturesProps,
} from "@/components/ProjectFeaturesController";
import { WorktreeGroup } from "@/components/WorktreeGroup";
import { VirtualizedProjectFeatureList } from "@/components/VirtualizedProjectFeatureList";
import { VirtualizedArchivedFeatureList } from "@/components/VirtualizedArchivedFeatureList";
import { deleteFeatureDialogTitle } from "@/lib/feature-archive-decision";
import { useReorderAnimation } from "@/hooks/useReorderAnimation";

export function ProjectFeatures(props: ProjectFeaturesProps) {
  const controller = useProjectFeaturesController(props);
  const virtualizeActive = controller.renderedActiveFeatureCount > 20;
  const virtualizeArchived = controller.archivedFeatures.length > 20;
  const listRef = useRef<HTMLDivElement>(null);
  useReorderAnimation(listRef, controller.orderedIds);
  return (
    <div ref={listRef} className="flex flex-col gap-0.5">
      {virtualizeActive ? (
        <VirtualizedProjectFeatureList
          activeFeatureId={props.activeFeatureId}
          flatActiveFeatures={controller.flatActiveFeatures}
          renderFeature={controller.renderFeature}
          rootNodeByFeatureId={controller.rootNodeByFeatureId}
          worktreeGroups={controller.worktreeGroups}
        />
      ) : (
        <>
          {controller.worktreeGroups.map((group) => (
            <WorktreeGroup
              key={group.key}
              label={group.label}
              features={group.features}
              renderFeature={controller.renderSubtree}
            />
          ))}
          {controller.flatActiveFeatures.map(controller.renderSubtree)}
        </>
      )}
      <DormantFeatureList controller={controller} />
      <ProjectFeatureDialogs projectId={props.projectId} controller={controller} />
      {virtualizeArchived ? (
        <VirtualizedArchivedFeatureList
          features={controller.archivedFeatures}
          expanded={controller.showArchived}
          onToggle={controller.toggleArchived}
          renderFeature={controller.renderFeature}
          activeFeatureId={props.activeFeatureId}
        />
      ) : (
        <ArchivedFeatureList
          features={controller.archivedFeatures}
          expanded={controller.showArchived}
          onToggle={controller.toggleArchived}
          renderFeature={controller.renderFeature}
        />
      )}
    </div>
  );
}

/** Conversations idle for a while, folded until asked for (G9). */
function DormantFeatureList({ controller }: { controller: ProjectFeaturesController }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ArchivedFeatureSection
      label="Dormant"
      features={controller.dormantFeatures}
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
    >
      {controller.dormantFeatures.map(controller.renderSubtree)}
    </ArchivedFeatureSection>
  );
}

function ProjectFeatureDialogs({
  projectId,
  controller,
}: {
  projectId: number;
  controller: ProjectFeaturesController;
}) {
  const { confirmation } = controller;
  return (
    <>
      <ArchiveFeatureDialog
        open={controller.confirmFeatureId != null && confirmation.action === "archive"}
        feature={confirmation.feature}
        projectId={projectId}
        hasLiveWorktree={confirmation.cleanup.hasLiveWorktree}
        hasResidualWorktreeDirectory={confirmation.cleanup.hasResidualWorktreeDirectory}
        showWorktreeRemoval={confirmation.cleanup.showWorktreeRemoval}
        showBranchRemoval={confirmation.cleanup.showBranchRemoval}
        onOpenChange={(open) => {
          if (!open) controller.setConfirmFeatureId(null);
        }}
        onArchive={controller.actions.archiveFeature}
      />
      <ConfirmDialog
        open={controller.confirmFeatureId != null && confirmation.action === "delete"}
        onOpenChange={(open) => {
          if (!open) controller.setConfirmFeatureId(null);
        }}
        title={deleteFeatureDialogTitle(confirmation.feature)}
        description="This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (controller.confirmFeatureId == null) return;
          controller.actions.deleteFeature(controller.confirmFeatureId);
        }}
      />
    </>
  );
}
