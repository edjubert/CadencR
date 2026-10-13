import { memo, useCallback, type ReactElement } from "react";
import { PinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavShortcutHint } from "@/hooks/useNavShortcutHints";
import { ProjectBadge } from "@/components/ProjectBadge";
import { useFeatureTitle } from "@/hooks/useFeatureTitle";
import { useOpenFeaturePort } from "@/hooks/useOpenFeaturePort";
import { useSidebarRowActionListener } from "@/hooks/useSidebarRowActionListener";
import { useProjectFeatureRowState } from "@/hooks/useProjectFeatureRowState";
import { NO_PORTS } from "@/hooks/useFeaturePorts";
import { useBrowserStore } from "@/stores/browser-store";
import { shouldIgnoreFeatureRowKeyDown } from "@/components/ProjectFeatureRow";
import { FeatureRowBody } from "@/components/FeatureRowBody";
import type { AllocatedPort, Feature, FeatureWorktreeInfo } from "@/api/generated";

interface PinnedConversationRowProps {
  feature: Feature;
  activeFeatureId: number | null;
  /** Ports this conversation's own processes are listening on. */
  ports?: readonly AllocatedPort[];
  shellCount?: number;
  hasLiveWorktree?: boolean;
  worktree?: FeatureWorktreeInfo;
  onNavigate: (feature: Feature) => void;
  /** Pinned rows offer unpinning on hover; other cross-project rows (For me) pass nothing. */
  onUnpin?: (featureId: number) => void;
}

/**
 * A conversation row outside its project: the global "Pinned" section and the
 * "For me" block above the project list. It shows
 * the same title and meta line as {@link ProjectFeatureRow} (label, diff, PR,
 * shells, ports) so a conversation reads the same wherever it appears; label
 * editing and the context menu stay on the project row. The project color dot
 * is the cross-project recognition cue (rows from different projects sit
 * together here). Memoized + self-subscribed to its own live title/status via
 * narrow per-feature selectors, so a WS push for one conversation re-renders
 * only that row, not the whole section. The parent passes stable callbacks.
 */
export const PinnedConversationRow = memo(function PinnedConversationRow({
  feature,
  activeFeatureId,
  ports = NO_PORTS,
  shellCount = 0,
  hasLiveWorktree = false,
  worktree,
  onNavigate,
  onUnpin,
}: PinnedConversationRowProps): ReactElement {
  const { navRef, badgeRef } = useNavShortcutHint<HTMLDivElement>();
  const { title: liveTitle, isAutoNaming } = useFeatureTitle(feature.id);
  const browserCount = useBrowserStore((store) => store.countsByScope[feature.id] ?? 0);
  const downloadCount = useBrowserStore(
    (store) => store.activeDownloadCountsByScope[feature.id] ?? 0,
  );
  const state = useProjectFeatureRowState(
    feature,
    feature.project_id,
    activeFeatureId,
    hasLiveWorktree,
  );
  const { isActive, prefetchFeature } = state;
  const handleOpenPort = useOpenFeaturePort(feature, onNavigate);
  // Archive and label live on the project row; a pinned row can still unpin.
  useSidebarRowActionListener(navRef, { pin: onUnpin && (() => onUnpin(feature.id)) });
  const handleOpenConversation = useCallback((): void => {
    onNavigate(feature);
  }, [feature, onNavigate]);

  return (
    <div
      ref={navRef}
      role="button"
      tabIndex={0}
      data-nav-item
      data-nav-type="feature"
      data-nav-id={String(feature.id)}
      data-nav-project-id={String(feature.project_id)}
      className={`sidebar-row group/pinned relative flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md pl-2 pr-1.5 outline-none hover:bg-sidebar-accent ${
        isActive ? "bg-sidebar-accent" : ""
      }`}
      onClick={(e) => {
        if (isActive || e.detail > 1) return;
        onNavigate(feature);
      }}
      onMouseEnter={prefetchFeature}
      onFocus={prefetchFeature}
      onKeyDown={(e) => {
        if (shouldIgnoreFeatureRowKeyDown(e.target)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(feature);
        }
      }}
    >
      {/* Pinned to the title line's height so it stays beside the title when the meta line shows. */}
      <span className="flex h-6 shrink-0 items-center self-start">
        <ProjectBadge projectId={feature.project_id} />
      </span>

      <FeatureRowBody
        feature={feature}
        liveTitle={liveTitle ?? undefined}
        isAutoNaming={isAutoNaming}
        isArchived={false}
        hasWorktree={hasLiveWorktree}
        worktree={worktree}
        attention={state.attention}
        isActive={isActive}
        badgeRef={badgeRef}
        onOpenConversation={handleOpenConversation}
        actions={onUnpin && <UnpinAction featureId={feature.id} onUnpin={onUnpin} />}
        prStatus={state.prStatus}
        gitStats={state.gitStats}
        shellCount={shellCount}
        browserCount={browserCount}
        downloadCount={downloadCount}
        ports={ports}
        onOpenPort={handleOpenPort}
      />
    </div>
  );
});

function UnpinAction({
  featureId,
  onUnpin,
}: {
  featureId: number;
  onUnpin: (featureId: number) => void;
}): ReactElement {
  return (
    <span className="sidebar-row-actions">
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={true}
        className="size-6 shrink-0 p-0 text-foreground transition-none hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onUnpin(featureId);
        }}
      >
        <PinOffIcon className="size-3.5" />
        <span className="sr-only">Unpin</span>
      </Button>
    </span>
  );
}
