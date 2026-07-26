import { useCallback, useMemo, useState } from "react";
import { getClaudeCodeOauthUsage, useGetClaudeCodeOauthUsage } from "@/api/generated";
import type { OauthUsageResponse } from "@/api/generated";

interface ClaudeCodeOauthUsage {
  status: "available" | "not_applicable" | "unavailable" | "loading";
  snapshot: OauthUsageResponse["snapshot"] | null;
  reason: string | null;
  fetchedAt: number | null;
  isRefreshing: boolean;
  refresh: () => void;
}

export function useClaudeCodeOauthUsage(enabled: boolean): ClaudeCodeOauthUsage {
  const query = useGetClaudeCodeOauthUsage(undefined, { query: { enabled } });
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const isRefreshing = query.isFetching || isForceRefreshing;
  const { refetch } = query;

  const refresh = useCallback(() => {
    if (isRefreshing) return;
    setIsForceRefreshing(true);
    setRefreshError(null);
    // `refetch()` alone would replay the same (unforced) params — the
    // backend's TTL cache would just hand back the same stale snapshot. A
    // forced refresh needs its own request with `force: true`, then a
    // normal refetch to pull the now-fresh cache entry into this query.
    void getClaudeCodeOauthUsage({ force: true })
      .then(() => refetch())
      .catch((error: unknown) => {
        setRefreshError(error instanceof Error ? error.message : "Refresh failed");
      })
      .finally(() => setIsForceRefreshing(false));
  }, [isRefreshing, refetch]);

  return useMemo<ClaudeCodeOauthUsage>(() => {
    if (refreshError != null) {
      return {
        status: "unavailable",
        snapshot: null,
        reason: refreshError,
        fetchedAt: null,
        isRefreshing,
        refresh,
      };
    }
    if (query.isError) {
      return {
        status: "unavailable",
        snapshot: null,
        reason: "quota fetch failed",
        fetchedAt: null,
        isRefreshing,
        refresh,
      };
    }
    const data = query.data;
    if (!data) {
      return {
        status: "loading",
        snapshot: null,
        reason: null,
        fetchedAt: null,
        isRefreshing,
        refresh,
      };
    }
    return {
      status: data.status,
      snapshot: data.snapshot ?? null,
      reason: data.reason ?? null,
      fetchedAt: data.fetched_at,
      isRefreshing,
      refresh,
    };
  }, [query.data, query.isError, refreshError, isRefreshing, refresh]);
}
