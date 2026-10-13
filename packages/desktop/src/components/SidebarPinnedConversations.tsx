import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PinIcon } from "lucide-react";
import { toast } from "sonner";
import { useListPinnedFeatures, useUpdateFeaturePinned, type Feature } from "@/api/generated";
import { PinnedConversationRow } from "@/components/PinnedConversationRow";
import { SidebarBlock } from "@/components/SidebarBlock";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { useCrossProjectNavigate } from "@/hooks/useCrossProjectNavigate";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { apiErrorMessage } from "@/lib/api-errors";
import { useReorderAnimation } from "@/hooks/useReorderAnimation";
import { useStableFeatureOrder } from "@/hooks/useStableFeatureOrder";
import { NO_PORTS, useFeaturePorts } from "@/hooks/useFeaturePorts";
import { usePinnedActivity } from "@/hooks/usePinnedActivity";
import { useSidebarFilteredFeatures } from "@/hooks/useSidebarFilteredFeatures";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";
import { useSidebarBlockFold } from "@/stores/sidebar-surface-store";

/**
 * Global "Pinned" section rendered above the project list. Pinning is a
 * feature-level concept (`features.is_pinned`), so a single backend query
 * returns every pinned conversation across all projects — each row carries its
 * project color dot so the user can tell them apart at a glance. Renders
 * nothing when no conversation is pinned, unless empty blocks are kept.
 *
 * Unpinning here and pinning from a project row both write the same column and
 * invalidate the `/api/features` cache prefix (which covers this list); there
 * is no optimistic state — the section re-renders from the refetched data.
 */
const EMPTY_FEATURES: Feature[] = [];

export function SidebarPinnedConversations({
  activeFeatureId,
  onSelectFeature,
}: {
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}): ReactElement | null {
  const queryClient = useQueryClient();
  const { data: fetchedPinned = EMPTY_FEATURES } = useListPinnedFeatures();
  const orderedPinned = useStableFeatureOrder(fetchedPinned);
  const activity = usePinnedActivity(fetchedPinned);
  const pinnedFeatures = useSidebarFilteredFeatures(orderedPinned, activity.worktreeByFeatureId);
  const listRef = useRef<HTMLElement>(null);
  const pinnedIds = useMemo(() => pinnedFeatures.map((feature) => feature.id), [pinnedFeatures]);
  useReorderAnimation(listRef, pinnedIds);
  const portsByFeatureId = useFeaturePorts();
  const handleNavigate = useCrossProjectNavigate(activeFeatureId, onSelectFeature);
  const hideEmpty = useSidebarOption("hideEmptyBlocks");
  const filtering = useSidebarFilterQuery() !== "";
  const fold = useSidebarBlockFold("pinned");

  const { mutate: updateFeaturePinned } = useUpdateFeaturePinned({
    mutation: {
      onSuccess: () => void invalidateByUrlPrefix(queryClient, "/api/features"),
      onError: (error) => {
        toast.error(apiErrorMessage(error, "Failed to update pinned state"));
      },
    },
  });

  const handleUnpin = useCallback(
    (featureId: number): void => {
      updateFeaturePinned({ id: featureId, data: { pinned: false } });
    },
    [updateFeaturePinned],
  );

  const isEmpty = pinnedFeatures.length === 0;
  // An empty Pinned block only shows when empty blocks are kept and nothing is filtered out.
  if (isEmpty && (hideEmpty || filtering)) return null;

  return (
    <SidebarBlock
      ref={listRef}
      block="pinned"
      label="Pinned"
      icon={PinIcon}
      count={pinnedFeatures.length}
      fold={fold}
      empty="Pin a conversation to keep it here"
      isEmpty={isEmpty}
      capped
    >
      {pinnedFeatures.map((feature) => (
        <PinnedConversationRow
          key={feature.id}
          feature={feature}
          activeFeatureId={activeFeatureId}
          ports={portsByFeatureId.get(feature.id) ?? NO_PORTS}
          shellCount={activity.shellCountByFeatureId.get(feature.id) ?? 0}
          hasLiveWorktree={activity.liveWorktreeFeatureIds.has(feature.id)}
          worktree={activity.worktreeByFeatureId.get(feature.id)}
          onNavigate={handleNavigate}
          onUnpin={handleUnpin}
        />
      ))}
    </SidebarBlock>
  );
}
