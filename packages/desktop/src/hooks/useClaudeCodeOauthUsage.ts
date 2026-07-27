import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getClaudeCodeOauthUsage,
  getGetClaudeCodeOauthUsageQueryKey,
  useDeleteClaudeCodeOauthUsageCache,
  useGetClaudeCodeOauthUsage,
} from "@/api/generated";
import type { OauthUsageResponse } from "@/api/generated";

interface ClaudeCodeOauthUsage {
  status: "available" | "not_applicable" | "unavailable" | "loading";
  snapshot: OauthUsageResponse["snapshot"] | null;
  reason: string | null;
  fetchedAt: number | null;
  isRefreshing: boolean;
  isResetting: boolean;
  refresh: () => void;
  reset: () => void;
}

// Manual refresh bypasses the backend's 60s cache TTL by design (that's the
// point of a refresh button), so nothing server-side stops rapid clicking
// from hammering Anthropic's rate-limited oauth/usage endpoint. This is a
// client-side cooldown on top of the isRefreshing guard, not tied to
// success/failure — a failed fetch must stay retryable, just not on every
// click.
const REFRESH_COOLDOWN_MS = 10_000;

export function useClaudeCodeOauthUsage(enabled: boolean): ClaudeCodeOauthUsage {
  const queryClient = useQueryClient();
  const query = useGetClaudeCodeOauthUsage(undefined, { query: { enabled } });
  const deleteMutation = useDeleteClaudeCodeOauthUsageCache();
  const [isForceRefreshing, setIsForceRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const isRefreshing = query.isFetching || isForceRefreshing;
  const { refetch } = query;
  const lastRefreshAtRef = useRef(0);

  const refresh = useCallback(() => {
    if (isRefreshing) return;
    if (Date.now() - lastRefreshAtRef.current < REFRESH_COOLDOWN_MS) return;
    lastRefreshAtRef.current = Date.now();
    setIsForceRefreshing(true);
    setRefreshError(null);
    void getClaudeCodeOauthUsage({ force: true })
      .then(() => refetch())
      .catch((error: unknown) => {
        setRefreshError(error instanceof Error ? error.message : "Refresh failed");
      })
      .finally(() => setIsForceRefreshing(false));
  }, [isRefreshing, refetch]);

  const reset = useCallback(() => {
    if (deleteMutation.isPending) return;
    void deleteMutation.mutateAsync().then(() => {
      void queryClient.invalidateQueries({
        queryKey: getGetClaudeCodeOauthUsageQueryKey(),
      });
    });
  }, [deleteMutation, queryClient]);

  const isResetting = deleteMutation.isPending;

  return useMemo<ClaudeCodeOauthUsage>(() => {
    if (refreshError != null) {
      return {
        status: "unavailable",
        snapshot: null,
        reason: refreshError,
        fetchedAt: null,
        isRefreshing,
        isResetting,
        refresh,
        reset,
      };
    }
    if (query.isError) {
      return {
        status: "unavailable",
        snapshot: null,
        reason: query.error instanceof Error ? query.error.message : "quota fetch failed",
        fetchedAt: null,
        isRefreshing,
        isResetting,
        refresh,
        reset,
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
        isResetting,
        refresh,
        reset,
      };
    }
    return {
      status: data.status,
      snapshot: data.snapshot ?? null,
      reason: data.reason ?? null,
      fetchedAt: data.fetched_at,
      isRefreshing,
      isResetting,
      refresh,
      reset,
    };
  }, [query.data, query.isError, refreshError, isRefreshing, isResetting, refresh, reset]);
}
