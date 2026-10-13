import type { ReactElement, ReactNode, RefObject } from "react";
import type {
  AllocatedPort,
  Feature,
  FeatureWorktreeInfo,
  GitStats,
  PrStatusSnapshot,
} from "@/api/generated";
import { FeatureRowTitleLine } from "@/components/FeatureRowTitleLine";
import { FeatureRowMetaLine, type FeatureLabelEditing } from "@/components/ProjectFeatureRowParts";
import { FeatureRowPreviewLine } from "@/components/FeatureRowSummaryParts";
import { SidebarPendingRequestLine } from "@/components/SidebarPendingRequestLine";
import { useFeatureRowSummary } from "@/hooks/useFeatureRowSummary";
import type { Attention } from "@/lib/sidebar-attention";
import type { SidebarConfig } from "@/lib/sidebar-config";
import { rowLayout } from "@/lib/sidebar-row-summary";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { useShallow } from "zustand/react/shallow";

export interface FeatureRowBodyProps {
  feature: Feature;
  liveTitle: string | undefined;
  isAutoNaming: boolean;
  isArchived: boolean;
  hasWorktree: boolean;
  worktree: FeatureWorktreeInfo | undefined;
  attention: Attention;
  isActive: boolean;
  badgeRef?: RefObject<HTMLSpanElement | null>;
  onOpenConversation: () => void;
  /** The hover actions, in the title line before the time they replace. */
  actions?: ReactNode;
  prStatus: PrStatusSnapshot | undefined;
  gitStats: GitStats | undefined;
  shellCount: number;
  browserCount: number;
  downloadCount: number;
  ports: readonly AllocatedPort[];
  labelEditor?: FeatureLabelEditing;
  onOpenPort: (port: number) => void;
}

/**
 * What a conversation row shows, wherever it is: the title line, what a
 * waiting conversation asks for (else the agent's last reply), and the
 * details, beside the title (uniform rows) or on their own line. Compact rows
 * keep only the title line until their conversation waits. Takes plain values,
 * so the project tree, the blocks above it and the display options preview
 * render the exact same row from their own data.
 */
export function FeatureRowBody({
  feature,
  liveTitle,
  isAutoNaming,
  isArchived,
  hasWorktree,
  worktree,
  attention,
  isActive,
  badgeRef,
  onOpenConversation,
  actions,
  prStatus,
  gitStats,
  shellCount,
  browserCount,
  downloadCount,
  ports,
  labelEditor,
  onOpenPort,
}: FeatureRowBodyProps): ReactElement {
  const options = useSidebarConfigStore(useShallow((state) => rowOptions(state.config)));
  const layout = rowLayout(options, attention.state, labelEditor !== undefined);
  const summary = useFeatureRowSummary(
    feature.id,
    attention.state,
    layout.showsPreview || layout.showsTodos,
  );
  const details = layout.compact ? null : (
    <FeatureRowMetaLine
      feature={feature}
      worktree={worktree}
      prStatus={prStatus}
      gitStats={gitStats}
      shellCount={shellCount}
      browserCount={browserCount}
      downloadCount={downloadCount}
      ports={ports}
      labelEditor={labelEditor}
      onOpenPort={onOpenPort}
      summary={summary}
      inline={layout.foldMeta}
    />
  );
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <FeatureRowTitleLine
        feature={feature}
        liveTitle={liveTitle}
        isAutoNaming={isAutoNaming}
        isArchived={isArchived}
        hasWorktree={hasWorktree}
        worktree={worktree}
        attention={attention}
        isActive={isActive}
        badgeRef={badgeRef}
        onOpenConversation={onOpenConversation}
        details={layout.foldMeta ? details : undefined}
      >
        {actions}
      </FeatureRowTitleLine>
      {!layout.compact && (
        <>
          <SidebarPendingRequestLine attention={attention} />
          {layout.showsPreview && <FeatureRowPreviewLine summary={summary} />}
          {!layout.foldMeta && details}
        </>
      )}
    </div>
  );
}

function rowOptions(config: SidebarConfig) {
  return {
    compactRows: config.compactRows,
    uniformRows: config.uniformRows,
    titleLines: config.titleLines,
    preview: config.preview,
    todos: config.todos,
    pendingRequest: config.pendingRequest,
  };
}
