import { useGetStats, type Feature, type GitStats, type PrStatusSnapshot } from "@/api/generated";
import { useFeaturePrefetch } from "@/hooks/useFeaturePrefetch";
import { useFeatureStatus } from "@/stores/session-status-selectors";
import { useIsFeatureUnread } from "@/stores/unread-store";
import { selectPrStatus, usePrStatusStore } from "@/stores/usePrStatusStore";
import type { LiveAgentStatus } from "@/stores/session-status-store";

interface FeatureRowState {
  liveStatus: LiveAgentStatus;
  isUnread: boolean;
  prStatus: PrStatusSnapshot | undefined;
  gitStats: GitStats | undefined;
  isActive: boolean;
  isArchived: boolean;
  isPinned: boolean;
  prefetchFeature: () => void;
}

/**
 * Everything a sidebar feature row derives from stores and queries, kept out of
 * the component so its render stays readable.
 *
 * Returns a plain literal rather than a memo: the row destructures it on the
 * spot and passes the individual values down, so no `React.memo` downstream
 * ever observes the object's identity.
 */
export function useProjectFeatureRowState(
  feature: Feature,
  projectId: number,
  activeFeatureId: number | null,
  hasLiveWorktree: boolean,
): FeatureRowState {
  // Live status is the canonical 3-value enum: per-session entries pushed by
  // the backend, aggregated here per-feature. `useShallow` inside the hook
  // ensures this row only re-renders when its own feature's (status, kind)
  // actually changes.
  const { status: liveStatus } = useFeatureStatus(feature.id);
  // Blue unread dot: the agent finished while this conversation was not open.
  // Working and pending-gate indicators take precedence in the status slot.
  const isUnread = useIsFeatureUnread(feature.id);
  const prStatus = usePrStatusStore(selectPrStatus(feature.id));
  const isActive = activeFeatureId === feature.id;
  const { data: gitStats } = useGetStats(
    { feature_id: feature.id, mode: "worktree" },
    {
      query: {
        // Limit fan-out: fetch only for live worktrees or the active row (which
        // the Git tab is already fetching). Other rows reuse the cache.
        enabled: hasLiveWorktree || isActive,
        refetchInterval: 5 * 60 * 1000,
        retry: false,
      },
    },
  );
  const prefetchFeature = useFeaturePrefetch(feature.id, projectId);

  return {
    liveStatus,
    isUnread,
    prStatus,
    gitStats,
    isActive,
    isArchived: feature.status === "archived",
    isPinned: feature.is_pinned,
    prefetchFeature,
  };
}
