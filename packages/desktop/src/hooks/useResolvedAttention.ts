import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { FeatureStatus, getGetFeatureQueryOptions, type Feature } from "@/api/generated";
import { useAttentionIndex } from "@/hooks/useAttentionIndex";
import { apiErrorMessage } from "@/lib/api-errors";
import type { ActiveAttentionState, AttentionEntry } from "@/lib/attention-index";
import { needsUser } from "@/lib/sidebar-attention";
import { lookupFeature } from "@/stores/session-status-handlers";

export interface ResolvedAttention {
  feature: Feature;
  state: ActiveAttentionState;
}

export interface ProjectAttentionCounts {
  waiting: number;
  failed: number;
  working: number;
  unread: number;
}

export interface ResolvedAttentionResult {
  /** The attention index itself, straight from the stores (no request). */
  entries: readonly AttentionEntry[];
  /** Every conversation needing a look, in the attention index's order. */
  items: readonly ResolvedAttention[];
  /** The items asking something of the user: agents at work left out. */
  queue: readonly ResolvedAttention[];
  byProject: ReadonlyMap<number, ProjectAttentionCounts>;
  /**
   * The states with a conversation still being looked up, each once in index
   * order: a surface waits only on the states it shows.
   */
  loadingStates: readonly ActiveAttentionState[];
}

interface FeatureResult {
  data?: Feature;
  error: unknown;
  isPending: boolean;
}

const FEATURE_STALE_MS = 60_000;
const ERROR_TOAST_ID = "sidebar-attention-load-error";

/**
 * The attention index with each conversation's record, so surfaces can show its
 * title and group it by project even when that project is collapsed and its
 * list was never fetched. A conversation already in a loaded project list
 * starts from that record; the others cost one small request each, cached and
 * shared by every surface. Archived and deleted conversations drop out.
 */
export function useResolvedAttention(): ResolvedAttentionResult {
  const entries = useAttentionIndex();
  const combine = useCallback(
    (results: FeatureResult[]) => resolveEntries(entries, results),
    [entries],
  );
  const resolved = useQueries({
    queries: entries.map((entry) =>
      getGetFeatureQueryOptions(entry.featureId, {
        query: {
          staleTime: FEATURE_STALE_MS,
          retry: false,
          initialData: () => lookupFeature(entry.featureId),
        },
      }),
    ),
    combine,
  });
  useEffect(() => {
    if (resolved.error) {
      toast.error(apiErrorMessage(resolved.error, "Could not load conversations needing you"), {
        id: ERROR_TOAST_ID,
      });
    }
  }, [resolved.error]);
  const byProject = useStableProjectCounts(resolved.items);
  const queue = useMemo(
    () => resolved.items.filter((item) => needsUser(item.state)),
    [resolved.items],
  );
  return useMemo(
    () => ({
      entries,
      items: resolved.items,
      queue,
      byProject,
      loadingStates: resolved.loadingStates,
    }),
    [entries, resolved.items, queue, byProject, resolved.loadingStates],
  );
}

function resolveEntries(entries: readonly AttentionEntry[], results: FeatureResult[]) {
  const items: ResolvedAttention[] = [];
  let error: unknown = null;
  // An array, not a Set: `combine`'s structural sharing keeps it stable while equal.
  const loadingStates: ActiveAttentionState[] = [];
  results.forEach((result, index) => {
    const entry = entries[index];
    if (!entry) return;
    if (result.isPending && !loadingStates.includes(entry.state)) loadingStates.push(entry.state);
    if (result.error && !isNotFound(result.error)) error ??= result.error;
    const feature = result.data;
    if (feature && feature.status !== FeatureStatus.archived) {
      items.push({ feature, state: entry.state });
    }
  });
  return { items, error, loadingStates };
}

/** A deleted conversation can keep a status or unread mark: it simply leaves. */
function isNotFound(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

export function countByProject(
  items: readonly ResolvedAttention[],
): Map<number, ProjectAttentionCounts> {
  const counts = new Map<number, ProjectAttentionCounts>();
  for (const { feature, state } of items) {
    const current = counts.get(feature.project_id) ?? {
      waiting: 0,
      failed: 0,
      working: 0,
      unread: 0,
    };
    current[state] += 1;
    counts.set(feature.project_id, current);
  }
  return counts;
}

function sameCounts(a: ProjectAttentionCounts, b: ProjectAttentionCounts): boolean {
  return (
    a.waiting === b.waiting &&
    a.failed === b.failed &&
    a.working === b.working &&
    a.unread === b.unread
  );
}

/**
 * Per-project counts that keep their identity while unchanged, so a memoized
 * project badge re-renders only when its own project's counts move.
 */
function useStableProjectCounts(
  items: readonly ResolvedAttention[],
): ReadonlyMap<number, ProjectAttentionCounts> {
  const previous = useRef<ReadonlyMap<number, ProjectAttentionCounts>>(new Map());
  return useMemo(() => {
    const next = countByProject(items);
    const prior = previous.current;
    for (const [projectId, counts] of next) {
      const old = prior.get(projectId);
      if (old && sameCounts(old, counts)) next.set(projectId, old);
    }
    previous.current = next;
    return next;
  }, [items]);
}
