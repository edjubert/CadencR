import { memo, useCallback, useRef, type ReactElement, type ReactNode } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { AllocatedPort, Feature, FeatureWorktreeInfo } from "@/api/generated";
import { SidebarShortcutBadge } from "@/components/SidebarShortcutBadge";
import { ProjectFeatureContextMenu } from "@/components/ProjectFeatureContextMenu";
import {
  FeatureRowActions,
  FeatureRowMetaLine,
  FeatureRowStatusIcon,
  FeatureRowTitleLine,
} from "@/components/ProjectFeatureRowParts";
import { useNavShortcutHint } from "@/hooks/useNavShortcutHints";
import { useProjectFeatureRowState } from "@/hooks/useProjectFeatureRowState";
import { portUrl } from "@/lib/feature-ports";
import { openLink } from "@/lib/link-routing";

const ROW_KEYDOWN_IGNORED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  "[data-ignore-feature-row-keydown]",
].join(", ");

interface ProjectFeatureRowProps {
  feature: Feature;
  projectId: number;
  activeFeatureId: number | null;
  liveTitle: string | undefined;
  isAutoNaming: boolean;
  /** True when the feature has a worktree recorded in feature settings (icon). */
  hasWorktree: boolean;
  /** True only when the worktree directory still exists on disk (stats query). */
  hasLiveWorktree: boolean;
  worktree: FeatureWorktreeInfo | undefined;
  shellCount: number;
  browserCount: number;
  /** Ports this conversation's own terminal/agent processes are listening on. */
  ports: readonly AllocatedPort[];
  isEditingLabel: boolean;
  labelDraft: string;
  labelSuggestions: readonly string[];
  isSavingLabel: boolean;
  onNavigate: (feature: Feature) => void;
  onStartLabelEdit: (feature: Feature) => void;
  onLabelDraftChange: (value: string) => void;
  onSaveLabel: (featureId: number, override?: string) => void;
  onCancelLabelEdit: () => void;
  onArchiveOrDelete: (featureId: number) => void;
  onUnarchive: (featureId: number) => void;
  onTogglePin: (featureId: number, pinned: boolean) => void;
  onCloseActivity: (featureId: number, shellCount: number, browserCount: number) => void;
  /** Expand/collapse twisty rendered by FeatureSubtree. */
  hierarchyControl?: ReactNode;
  /** Zero-based nesting depth; indentation stays inside the full-width row. */
  hierarchyDepth?: number;
}

const FEATURE_NESTING_INDENT_PX = 16;

type ProjectFeatureRowState = ReturnType<typeof useProjectFeatureRowState>;

interface FeatureRowDetailsProps {
  props: ProjectFeatureRowProps;
  state: ProjectFeatureRowState;
  onOpenConversation: () => void;
  onOpenPort: (port: number) => void;
}

function FeatureRowDetails({
  props,
  state,
  onOpenConversation,
  onOpenPort,
}: FeatureRowDetailsProps): ReactElement {
  const {
    feature,
    liveTitle,
    isAutoNaming,
    hasWorktree,
    shellCount,
    browserCount,
    ports,
    isEditingLabel,
    labelDraft,
    labelSuggestions,
    isSavingLabel,
    onLabelDraftChange,
    onSaveLabel,
    onCancelLabelEdit,
    onTogglePin,
    onArchiveOrDelete,
  } = props;
  return (
    <>
      <FeatureRowStatusIcon
        featureId={feature.id}
        liveStatus={state.liveStatus}
        isActive={state.isActive}
        isUnread={state.isUnread}
        onOpenConversation={onOpenConversation}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <FeatureRowTitleLine
          feature={feature}
          liveTitle={liveTitle}
          isAutoNaming={isAutoNaming}
          isArchived={state.isArchived}
          hasWorktree={hasWorktree}
        />
        <FeatureRowMetaLine
          feature={feature}
          prStatus={state.prStatus}
          gitStats={state.gitStats}
          shellCount={shellCount}
          browserCount={browserCount}
          ports={ports}
          isEditingLabel={isEditingLabel}
          labelDraft={labelDraft}
          labelSuggestions={labelSuggestions}
          isSavingLabel={isSavingLabel}
          onLabelDraftChange={onLabelDraftChange}
          onSaveLabel={onSaveLabel}
          onCancelLabelEdit={onCancelLabelEdit}
          onOpenPort={onOpenPort}
        />
      </div>
      <FeatureRowActions
        featureId={feature.id}
        isArchived={state.isArchived}
        isPinned={state.isPinned}
        onTogglePin={onTogglePin}
        onArchiveOrDelete={onArchiveOrDelete}
      />
    </>
  );
}

interface FeatureRowMenuProps {
  props: ProjectFeatureRowProps;
  state: ProjectFeatureRowState;
  onStartLabelEditAfterMenuClose: () => void;
}

function FeatureRowMenu({
  props,
  state,
  onStartLabelEditAfterMenuClose,
}: FeatureRowMenuProps): ReactElement {
  const {
    feature,
    liveTitle,
    worktree,
    shellCount,
    browserCount,
    onNavigate,
    onTogglePin,
    onCloseActivity,
    onUnarchive,
    onArchiveOrDelete,
  } = props;
  return (
    <ProjectFeatureContextMenu
      feature={feature}
      liveTitle={liveTitle}
      worktree={worktree}
      pullRequest={state.prStatus?.pr}
      isArchived={state.isArchived}
      isPinned={state.isPinned}
      hasActivity={shellCount > 0 || browserCount > 0}
      shellCount={shellCount}
      browserCount={browserCount}
      onNavigate={onNavigate}
      onTogglePin={onTogglePin}
      onStartLabelEditAfterMenuClose={onStartLabelEditAfterMenuClose}
      onCloseActivity={onCloseActivity}
      onUnarchive={onUnarchive}
      onArchiveOrDelete={onArchiveOrDelete}
    />
  );
}

/**
 * Memoized: rendered N times per project in the sidebar. A parent update
 * (label edit, project rename) must not re-render every row. The parent
 * passes stable callback refs and a stable `labelSuggestions` reference, so
 * default shallow-prop comparison is sufficient.
 */
export const ProjectFeatureRow = memo(function ProjectFeatureRow(
  props: ProjectFeatureRowProps,
): ReactElement {
  const {
    feature,
    projectId,
    activeFeatureId,
    hasLiveWorktree,
    onNavigate,
    onStartLabelEdit,
    hierarchyControl,
    hierarchyDepth = 0,
  } = props;
  const startLabelEditOnMenuCloseRef = useRef(false);
  const state = useProjectFeatureRowState(feature, projectId, activeFeatureId, hasLiveWorktree);
  const { navRef, badgeRef } = useNavShortcutHint<HTMLDivElement>();
  const markStartLabelEditAfterMenuClose = (): void => {
    startLabelEditOnMenuCloseRef.current = true;
  };

  const handleMenuCloseAutoFocus = (event: Event): void => {
    if (!startLabelEditOnMenuCloseRef.current) return;
    startLabelEditOnMenuCloseRef.current = false;
    event.preventDefault();
    onStartLabelEdit(feature);
  };

  const handleOpenConversation = useCallback((): void => {
    onNavigate(feature);
  }, [feature, onNavigate]);

  // Browser tabs are scoped per feature, so a port opened from another
  // conversation's row would land in a pane the user isn't looking at.
  // `openLink` falls back to the system browser off the desktop shell.
  const handleOpenPort = useCallback(
    (port: number): void => {
      onNavigate(feature);
      void openLink(portUrl(port), {
        target: "cadencr",
        scopeId: feature.id,
        cookieMode: "normal",
        domains: [],
      });
    },
    [feature, onNavigate],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={navRef}
          role="button"
          tabIndex={0}
          data-nav-item
          data-nav-type="feature"
          data-nav-id={String(feature.id)}
          data-nav-project-id={String(projectId)}
          data-feature-depth={hierarchyDepth}
          className={`group/feature relative flex min-w-0 cursor-pointer items-center gap-0.5 rounded-md py-1.5 pl-3 pr-1.5 text-sm outline-none transition-colors hover:bg-sidebar-accent ${
            state.isActive ? "bg-sidebar-accent" : ""
          } ${state.isArchived ? "opacity-50" : ""}`}
          onClick={(e) => {
            if (state.isActive || e.detail > 1) return;
            onNavigate(feature);
          }}
          onMouseEnter={state.prefetchFeature}
          onFocus={state.prefetchFeature}
          onKeyDown={(e) => {
            if (shouldIgnoreFeatureRowKeyDown(e.target)) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate(feature);
            }
          }}
        >
          <SidebarShortcutBadge ref={badgeRef} />
          <div
            data-feature-hierarchy-gutter
            className="flex h-3 w-2 shrink-0 items-center justify-center"
            style={{ marginInlineStart: hierarchyDepth * FEATURE_NESTING_INDENT_PX }}
          >
            {hierarchyControl}
          </div>

          <FeatureRowDetails
            props={props}
            state={state}
            onOpenConversation={handleOpenConversation}
            onOpenPort={handleOpenPort}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        // Open the label editor after the menu fully closes. Opening directly
        // from onSelect races with Radix's context-menu focus/pointer teardown.
        onCloseAutoFocus={handleMenuCloseAutoFocus}
      >
        <FeatureRowMenu
          props={props}
          state={state}
          onStartLabelEditAfterMenuClose={markStartLabelEditAfterMenuClose}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

export function shouldIgnoreFeatureRowKeyDown(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(ROW_KEYDOWN_IGNORED_SELECTOR) !== null;
}
