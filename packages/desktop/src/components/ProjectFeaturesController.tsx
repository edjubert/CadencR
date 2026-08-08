import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  useDeleteFeature,
  useIsFeatureEmpty,
  useListFeatures,
  useListFeatureWorktrees,
  useUpdateFeatureLabel,
  useUpdateFeaturePinned,
  useUpdateFeatureStatus,
  type Feature,
  type FeatureStatus,
  type FeatureWorktreeInfo,
} from "@/api/generated";
import { FeatureSubtree } from "@/components/FeatureSubtree";
import { ProjectFeatureRow } from "@/components/ProjectFeatureRow";
import {
  adjacentFeature,
  archiveFeatureInCachedLists,
  closeFeatureSession,
  navigateToFeatureOrHome,
  removeFeatureFromCachedLists,
} from "@/components/project-feature-navigation";
import { apiErrorMessage } from "@/lib/api-errors";
import { getArchiveCleanupAvailability } from "@/components/archive-cleanup-availability";
import { getFocusedTabForFeature } from "@/lib/feature-focus-handoff";
import { partitionActiveFeatures } from "@/lib/feature-grouping";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { buildFeatureForest } from "@/lib/feature-hierarchy";
import { normalizeLabel, uniqueLabels } from "@/lib/feature-labels";
import { getPendingFeatureArchiveAction } from "@/lib/feature-archive-decision";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { isInCodeMirrorEditor } from "@/lib/shortcuts/dom-targets";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { useCloseFeatureActivity } from "@/hooks/useCloseFeatureActivity";
import { useFeatureActivityCounts } from "@/hooks/useFeatureActivityCounts";
import { NO_PORTS, useFeaturePorts } from "@/hooks/useFeaturePorts";
import { useGlobalShortcutById } from "@/hooks/useShortcut";
import { useLiveFeatureMeta } from "@/hooks/useLiveFeatureMeta";

export const ACTIVE_FEATURE_STATUS: FeatureStatus = "active";
export const ARCHIVED_FEATURE_STATUS: FeatureStatus = "archived";

export interface ProjectFeaturesProps {
  projectId: number;
  projectPath: string;
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}

function useProjectFeaturesData({ projectId, projectPath, activeFeatureId }: ProjectFeaturesProps) {
  const { data: features = [] } = useListFeatures({
    project_id: projectId,
    include_archived: true,
  });
  const { data: featureWorktrees = [] } = useListFeatureWorktrees(
    { project_id: projectId },
    { query: { staleTime: 5 * 60 * 1000 } },
  );
  const { shellCountsByFeatureId, browserCountsByFeatureId } = useFeatureActivityCounts(projectId);
  const portsByFeatureId = useFeaturePorts();
  const liveMeta = useLiveFeatureMeta();
  const activeFeatures = useMemo(
    () => features.filter((feature) => feature.status === ACTIVE_FEATURE_STATUS),
    [features],
  );
  const archivedFeatures = useMemo(
    () => features.filter((feature) => feature.status === ARCHIVED_FEATURE_STATUS),
    [features],
  );
  const worktreeData = useMemo(() => {
    const worktreeFeatureIds = new Set<number>();
    const liveWorktreeFeatureIds = new Set<number>();
    const worktreeByFeatureId = new Map<number, FeatureWorktreeInfo>();
    for (const worktree of featureWorktrees) {
      worktreeFeatureIds.add(worktree.feature_id);
      worktreeByFeatureId.set(worktree.feature_id, worktree);
      if (worktree.live) liveWorktreeFeatureIds.add(worktree.feature_id);
    }
    return { worktreeFeatureIds, liveWorktreeFeatureIds, worktreeByFeatureId };
  }, [featureWorktrees]);
  const activeForest = useMemo(
    () => buildFeatureForest(activeFeatures.filter((feature) => !feature.is_pinned)),
    [activeFeatures],
  );
  const rootNodeByFeatureId = useMemo(
    () => new Map(activeForest.map((node) => [node.feature.id, node])),
    [activeForest],
  );
  const groupedFeatures = useMemo(
    () =>
      partitionActiveFeatures(
        activeForest.map((node) => node.feature),
        worktreeData.worktreeByFeatureId,
        projectPath,
      ),
    [activeForest, projectPath, worktreeData.worktreeByFeatureId],
  );
  const getLiveTitle = useCallback(
    (id: number): string | undefined =>
      liveMeta[wsSessionIdFromFeature(id)]?.featureTitle ?? undefined,
    [liveMeta],
  );
  const isAutoNaming = useCallback(
    (id: number): boolean => liveMeta[wsSessionIdFromFeature(id)]?.isAutoNaming ?? false,
    [liveMeta],
  );
  const labelSuggestions = useMemo(() => uniqueLabels(features), [features]);
  return {
    ...groupedFeatures,
    ...worktreeData,
    activeFeature: features.find((feature) => feature.id === activeFeatureId),
    activeFeatures,
    archivedFeatures,
    browserCountsByFeatureId,
    features,
    getLiveTitle,
    isAutoNaming,
    labelSuggestions,
    portsByFeatureId,
    rootNodeByFeatureId,
    shellCountsByFeatureId,
  };
}

type ProjectFeaturesData = ReturnType<typeof useProjectFeaturesData>;

function useProjectFeatureLabels(data: ProjectFeaturesData) {
  const [editingFeatureId, setEditingFeatureId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const updateMutation = useUpdateFeatureLabel({
    mutation: {
      onSuccess: (_data, variables) => {
        setEditingFeatureId(null);
        setDraft("");
        invalidateFeatureQueries(variables.id, ["label"]);
      },
      onError: (error) => toast.error(apiErrorMessage(error, "Failed to update feature label")),
    },
  });
  const start = useCallback((feature: Feature): void => {
    setEditingFeatureId(feature.id);
    setDraft(feature.label ?? "");
  }, []);
  const cancel = useCallback((): void => setEditingFeatureId(null), []);
  const save = useCallback(
    (featureId: number, override?: string): void => {
      const normalized = normalizeLabel(override ?? draft);
      const current = data.features.find((feature) => feature.id === featureId);
      if (current && normalizeLabel(current.label ?? "") === normalized) {
        setEditingFeatureId(null);
        setDraft("");
        return;
      }
      updateMutation.mutate({ id: featureId, data: { label: normalized } });
    },
    [data.features, draft, updateMutation],
  );
  const shortcut = useCallback(
    (event: KeyboardEvent): void => {
      if (!data.activeFeature || isInCodeMirrorEditor(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      start(data.activeFeature);
    },
    [data.activeFeature, start],
  );
  useGlobalShortcutById("edit-label", shortcut, { enabled: data.activeFeature != null });
  return useMemo(
    () => ({ cancel, draft, editingFeatureId, save, setDraft, start, updateMutation }),
    [cancel, draft, editingFeatureId, save, start, updateMutation],
  );
}

function useProjectFeatureActions(props: ProjectFeaturesProps, data: ProjectFeaturesData) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const closeFeatureActivity = useCloseFeatureActivity();
  const invalidateFeatures = useCallback(
    () => void invalidateByUrlPrefix(queryClient, "/api/features"),
    [queryClient],
  );
  const updateStatusMutation = useUpdateFeatureStatus({
    mutation: {
      onSuccess: (_data, variables) => {
        if (
          variables.id === props.activeFeatureId &&
          variables.data.status === ARCHIVED_FEATURE_STATUS
        ) {
          archiveFeatureInCachedLists(queryClient, variables.id);
          closeFeatureSession(variables.id);
          navigateToFeatureOrHome(
            navigate,
            props.projectId,
            adjacentFeature(data.activeFeatures, variables.id),
          );
        }
        invalidateFeatures();
      },
      onError: (error) => toast.error(apiErrorMessage(error, "Failed to update feature status")),
    },
  });
  const deleteMutation = useDeleteFeature({
    mutation: {
      onSuccess: (_data, variables) => {
        removeFeatureFromCachedLists(queryClient, variables.id);
        closeFeatureSession(variables.id);
        if (variables.id === props.activeFeatureId) {
          navigateToFeatureOrHome(
            navigate,
            props.projectId,
            adjacentFeature(data.activeFeatures, variables.id),
          );
        }
        invalidateFeatures();
      },
    },
  });
  const pinnedMutation = useUpdateFeaturePinned({
    mutation: {
      onSuccess: invalidateFeatures,
      onError: (error) => toast.error(apiErrorMessage(error, "Failed to update pinned state")),
    },
  });
  const updateStatus = useCallback(
    (featureId: number, status: FeatureStatus): void =>
      updateStatusMutation.mutate({ id: featureId, data: { status } }),
    [updateStatusMutation],
  );
  const navigateToFeature = useCallback(
    (feature: Feature): void => {
      props.onSelectFeature(feature.id);
      const focusTab = getFocusedTabForFeature(props.activeFeatureId);
      const search = {
        cwd: props.projectPath,
        featureId: feature.id,
        projectId: props.projectId,
        ...(focusTab ? { focusTab } : {}),
      };
      void navigate({
        to: "/ws-session/$sessionId",
        params: { sessionId: wsSessionIdFromFeature(feature.id) },
        search,
      });
    },
    [navigate, props],
  );
  return {
    closeActivity: (featureId: number, shellCount: number, browserCount: number): void =>
      closeFeatureActivity({ projectId: props.projectId, featureId, shellCount, browserCount }),
    deleteFeature: (featureId: number): void => deleteMutation.mutate({ id: featureId }),
    navigateToFeature,
    togglePin: (featureId: number, pinned: boolean): void =>
      pinnedMutation.mutate({ id: featureId, data: { pinned } }),
    unarchive: (featureId: number): void => updateStatus(featureId, ACTIVE_FEATURE_STATUS),
    updateStatus,
  };
}

type ProjectFeatureActions = ReturnType<typeof useProjectFeatureActions>;

function useFeatureConfirmation(
  confirmFeatureId: number | null,
  data: ProjectFeaturesData,
): {
  action: ReturnType<typeof getPendingFeatureArchiveAction>;
  cleanup: ReturnType<typeof getArchiveCleanupAvailability>;
  feature: Feature | undefined;
} {
  const feature = data.features.find((candidate) => candidate.id === confirmFeatureId);
  const isDelete = feature?.status === ARCHIVED_FEATURE_STATUS;
  const emptyCheck = useIsFeatureEmpty(confirmFeatureId ?? 0, {
    query: { enabled: confirmFeatureId != null && !isDelete, refetchOnMount: "always" },
  });
  const action = getPendingFeatureArchiveAction({
    feature,
    emptyResponse: emptyCheck.data,
    isCheckingEmpty: emptyCheck.isLoading || emptyCheck.isFetching,
    hasEmptyCheckError: emptyCheck.error != null,
  });
  useEffect(() => {
    if (emptyCheck.error == null || confirmFeatureId == null || isDelete) return;
    toast.error(apiErrorMessage(emptyCheck.error, "Failed to check whether session is empty"));
  }, [confirmFeatureId, emptyCheck.error, isDelete]);
  return {
    action,
    cleanup: getArchiveCleanupAvailability(
      feature ? data.worktreeByFeatureId.get(feature.id) : null,
    ),
    feature,
  };
}

function createFeatureRenderer(
  props: ProjectFeaturesProps,
  data: ProjectFeaturesData,
  labels: ReturnType<typeof useProjectFeatureLabels>,
  actions: ProjectFeatureActions,
  setConfirmFeatureId: (featureId: number | null) => void,
) {
  return (feature: Feature, hierarchyControl?: ReactNode, hierarchyDepth = 0): ReactNode => (
    <ProjectFeatureRow
      key={feature.id}
      feature={feature}
      projectId={props.projectId}
      activeFeatureId={props.activeFeatureId}
      liveTitle={data.getLiveTitle(feature.id)}
      isAutoNaming={data.isAutoNaming(feature.id)}
      hasWorktree={data.worktreeFeatureIds.has(feature.id)}
      hasLiveWorktree={data.liveWorktreeFeatureIds.has(feature.id)}
      worktree={data.worktreeByFeatureId.get(feature.id)}
      shellCount={data.shellCountsByFeatureId.get(feature.id) ?? 0}
      browserCount={data.browserCountsByFeatureId[feature.id] ?? 0}
      ports={data.portsByFeatureId.get(feature.id) ?? NO_PORTS}
      isEditingLabel={labels.editingFeatureId === feature.id}
      labelDraft={labels.editingFeatureId === feature.id ? labels.draft : ""}
      labelSuggestions={data.labelSuggestions}
      isSavingLabel={labels.updateMutation.isPending && labels.editingFeatureId === feature.id}
      onNavigate={actions.navigateToFeature}
      onStartLabelEdit={labels.start}
      onLabelDraftChange={labels.setDraft}
      onSaveLabel={labels.save}
      onCancelLabelEdit={labels.cancel}
      onArchiveOrDelete={setConfirmFeatureId}
      onUnarchive={actions.unarchive}
      onTogglePin={actions.togglePin}
      onCloseActivity={actions.closeActivity}
      hierarchyControl={hierarchyControl}
      hierarchyDepth={hierarchyDepth}
    />
  );
}

export function useProjectFeaturesController(props: ProjectFeaturesProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [confirmFeatureId, setConfirmFeatureId] = useState<number | null>(null);
  const data = useProjectFeaturesData(props);
  const labels = useProjectFeatureLabels(data);
  const actions = useProjectFeatureActions(props, data);
  const confirmation = useFeatureConfirmation(confirmFeatureId, data);
  useEffect(() => {
    if (data.activeFeature?.status === ARCHIVED_FEATURE_STATUS) setShowArchived(true);
  }, [data.activeFeature?.status]);
  const renderFeature = useMemo(
    () => createFeatureRenderer(props, data, labels, actions, setConfirmFeatureId),
    [actions, data, labels, props],
  );
  const renderSubtree = useCallback(
    (feature: Feature): ReactNode => {
      const node = data.rootNodeByFeatureId.get(feature.id);
      return node ? (
        <FeatureSubtree key={feature.id} node={node} renderFeature={renderFeature} />
      ) : (
        renderFeature(feature)
      );
    },
    [data.rootNodeByFeatureId, renderFeature],
  );
  return {
    actions,
    archivedFeatures: data.archivedFeatures,
    confirmFeatureId,
    confirmation,
    flatActiveFeatures: data.flatActiveFeatures,
    renderFeature,
    renderSubtree,
    setConfirmFeatureId,
    setShowArchived,
    showArchived,
    worktreeGroups: data.worktreeGroups,
  };
}

export type ProjectFeaturesController = ReturnType<typeof useProjectFeaturesController>;
