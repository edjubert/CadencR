import type { ReactElement } from "react";
import {
  ArchiveIcon,
  DownloadIcon,
  GitBranchIcon,
  GlobeIcon,
  PinIcon,
  PinOffIcon,
  TerminalIcon,
  TrashIcon,
} from "lucide-react";
import type {
  AllocatedPort,
  Feature,
  FeatureWorktreeInfo,
  GitStats,
  PrStatusSnapshot,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { FeatureLabelChip } from "@/components/FeatureLabelChip";
import { FeatureMetaBadge } from "@/components/FeatureMetaBadge";
import { FeaturePortsBadge } from "@/components/FeaturePortsBadge";
import { FeatureLabelEditor } from "@/components/FeatureLabelEditor";
import { FeaturePrIndicator } from "@/components/PrStatusIndicators";
import { FeatureTodoProgress, hasTodoChip } from "@/components/FeatureRowSummaryParts";
import type { RowSummary } from "@/lib/sidebar-row-summary";
import { NumStat } from "@/components/NumStat";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { useShallow } from "zustand/react/shallow";
import type { SidebarConfig } from "@/lib/sidebar-config";

interface FeatureRowMetaLineProps {
  feature: Feature;
  worktree: FeatureWorktreeInfo | undefined;
  prStatus: PrStatusSnapshot | undefined;
  gitStats: GitStats | undefined;
  shellCount: number;
  browserCount: number;
  downloadCount: number;
  ports: readonly AllocatedPort[];
  /** Present while the label is being edited; read-only rows never pass it. */
  labelEditor?: FeatureLabelEditing;
  onOpenPort: (port: number) => void;
  /** Feeds the todo progress, shown while some are left (when the option is on). */
  summary?: RowSummary;
  /** Beside the title (uniform rows): the items join the title line's flow. */
  inline?: boolean;
}

export interface FeatureLabelEditing {
  draft: string;
  suggestions: readonly string[];
  isSaving: boolean;
  onDraftChange: (value: string) => void;
  onSave: (override?: string) => void;
  onCancel: () => void;
}

/**
 * A sidebar feature row's details: label, branch, diff stat, pull-request
 * state, todo progress and running-activity badges, each one switchable in the
 * display options. Its own line under the title, or (`inline`) items that sit
 * beside the title as far as they fit. Renders nothing when the row has none of
 * them to show, so a bare row stays a single line.
 */
export function FeatureRowMetaLine({
  feature,
  worktree,
  prStatus,
  gitStats,
  shellCount,
  browserCount,
  downloadCount,
  ports,
  labelEditor,
  onOpenPort,
  summary,
  inline = false,
}: FeatureRowMetaLineProps): ReactElement | null {
  const show = useSidebarConfigStore(useShallow((state) => metaLineOptions(state.config)));
  const branch = show.branch ? worktree?.worktree_branch : null;
  const label = show.label === "hidden" ? null : feature.label;
  // "Logo + model": the logo keeps its title-line slot, the model reads here.
  const model =
    show.provider === "logo_model" && feature.runtime_provider
      ? feature.model_session?.trim() || "Default"
      : null;
  const hasStats =
    show.diff && gitStats != null && (gitStats.insertions > 0 || gitStats.deletions > 0);
  // `FeaturePrIndicator` also renders for an error with no proposal — a forge
  // auth failure must not be the one thing that keeps this line from mounting.
  const hasPrIndicator = show.pr && (prStatus?.pr != null || prStatus?.error != null);
  const hasActivity = show.activity && (shellCount > 0 || browserCount > 0 || downloadCount > 0);
  const hasPorts = show.ports && ports.length > 0;
  const todos = show.todos && hasTodoChip(summary) ? summary : null;
  if (
    !labelEditor &&
    !label &&
    !branch &&
    !model &&
    !hasStats &&
    !hasActivity &&
    !hasPorts &&
    !hasPrIndicator &&
    !todos
  ) {
    return null;
  }

  return (
    <div
      data-feature-meta-line
      className={
        inline
          ? "contents text-[11px]"
          : "flex min-w-0 items-center gap-2 pl-5 text-[11px] leading-tight"
      }
    >
      <MetaLineLabel feature={feature} label={label} style={show.label} editor={labelEditor} />
      {branch && (
        <span
          data-feature-branch
          title={branch}
          className="inline-flex min-w-0 items-center gap-1 text-muted-foreground"
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
          <span className="truncate font-mono text-[10.5px]">{branch}</span>
        </span>
      )}
      {model && (
        <span
          data-feature-model
          title={model}
          className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground"
        >
          {model}
        </span>
      )}
      {hasStats && (
        <span data-feature-diff className="inline-flex shrink-0">
          <NumStat
            additions={gitStats.insertions}
            deletions={gitStats.deletions}
            className="text-[11px] leading-tight"
          />
        </span>
      )}
      {show.pr && <FeaturePrIndicator snapshot={prStatus} />}
      {todos && <FeatureTodoProgress summary={todos} />}
      {hasActivity && (
        <FeatureActivityIndicators
          shellCount={shellCount}
          browserCount={browserCount}
          downloadCount={downloadCount}
        />
      )}
      {hasPorts && <FeaturePortsBadge ports={ports} onOpenPort={onOpenPort} />}
    </div>
  );
}

function metaLineOptions(config: SidebarConfig) {
  return {
    branch: config.branch,
    label: config.label,
    diff: config.diff,
    pr: config.pr,
    activity: config.activity,
    ports: config.ports,
    provider: config.provider,
    todos: config.todos,
  };
}

/** The label in its chosen style, or its editor while it is being edited. */
function MetaLineLabel({
  feature,
  label,
  style,
  editor,
}: {
  feature: Feature;
  label: string | null | undefined;
  style: SidebarConfig["label"];
  editor: FeatureLabelEditing | undefined;
}): ReactElement | null {
  if (!editor) {
    return style === "dot" ? <FeatureLabelDot label={label} /> : <FeatureLabelChip label={label} />;
  }
  return (
    <FeatureLabelEditor
      value={editor.draft}
      suggestions={editor.suggestions}
      isSaving={editor.isSaving}
      trigger={
        feature.label ? (
          <FeatureLabelChip label={feature.label} />
        ) : (
          <span className="rounded border border-dashed border-border px-1.5 py-0 font-mono text-[10.5px] leading-4 text-muted-foreground">
            Set label
          </span>
        )
      }
      onChange={editor.onDraftChange}
      onSave={editor.onSave}
      onCancel={editor.onCancel}
    />
  );
}

/** The quiet label style: a dot that names the label on hover. */
function FeatureLabelDot({ label }: { label: string | null | undefined }): ReactElement | null {
  if (!label) return null;
  return (
    <span
      role="img"
      data-feature-label
      aria-label={`Label: ${label}`}
      title={label}
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

/**
 * Both the hover affordance and the context menu name these actions by what the
 * click will do, so the wording lives next to the state it reads.
 */
export function pinActionLabel(isPinned: boolean): string {
  return isPinned ? "Unpin" : "Pin";
}

/** Archiving is reversible; a second pass on an archived row deletes it. */
export function archiveActionLabel(isArchived: boolean): string {
  return isArchived ? "Delete" : "Archive";
}

/**
 * Trailing hover affordances: pin and archive/delete. Rendered inside the row's
 * click target, so both stop propagation rather than navigating.
 */
export function FeatureRowActions({
  featureId,
  isArchived,
  isPinned,
  onTogglePin,
  onArchiveOrDelete,
}: {
  featureId: number;
  isArchived: boolean;
  isPinned: boolean;
  onTogglePin: (featureId: number, pinned: boolean) => void;
  onArchiveOrDelete: (featureId: number) => void;
}): ReactElement {
  return (
    <div className="sidebar-row-actions shrink-0 items-center gap-1">
      {!isArchived && (
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={isPinned}
          className={`size-6 shrink-0 p-0 hover:text-foreground transition-none ${
            isPinned ? "text-foreground" : "text-muted-foreground"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(featureId, !isPinned);
          }}
        >
          {isPinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
          <span className="sr-only">{pinActionLabel(isPinned)}</span>
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground transition-none"
        onClick={(e) => {
          e.stopPropagation();
          onArchiveOrDelete(featureId);
        }}
      >
        {isArchived ? <TrashIcon className="size-3.5" /> : <ArchiveIcon className="size-3.5" />}
        <span className="sr-only">{archiveActionLabel(isArchived)}</span>
      </Button>
    </div>
  );
}

function FeatureActivityIndicators({
  shellCount,
  browserCount,
  downloadCount,
}: {
  shellCount: number;
  browserCount: number;
  downloadCount: number;
}): ReactElement | null {
  if (shellCount <= 0 && browserCount <= 0 && downloadCount <= 0) return null;
  return (
    <span data-feature-activity-indicators className="inline-flex shrink-0 items-center gap-1">
      <FeatureActivityBadge
        count={shellCount}
        labelSingular="shell command running"
        labelPlural="shell commands running"
        icon={<TerminalIcon className="size-3" />}
      />
      <FeatureActivityBadge
        count={browserCount}
        labelSingular="browser tab open"
        labelPlural="browser tabs open"
        icon={<GlobeIcon className="size-3" />}
      />
      <FeatureActivityBadge
        count={downloadCount}
        labelSingular="browser download active"
        labelPlural="browser downloads active"
        icon={<DownloadIcon className="size-3" />}
      />
    </span>
  );
}

function FeatureActivityBadge({
  count,
  labelSingular,
  labelPlural,
  icon,
}: {
  count: number;
  labelSingular: string;
  labelPlural: string;
  icon: ReactElement;
}): ReactElement | null {
  if (count <= 0) return null;
  const label = `${count} ${count === 1 ? labelSingular : labelPlural}`;
  return (
    <FeatureMetaBadge icon={icon} label={label}>
      <span>{count}</span>
    </FeatureMetaBadge>
  );
}
