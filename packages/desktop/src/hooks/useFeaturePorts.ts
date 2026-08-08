import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useListFeaturePorts, type AllocatedPort } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

/** Stable reference so a row with no ports keeps its memoized props. */
export const NO_PORTS: readonly AllocatedPort[] = [];

/**
 * Each poll costs a machine-wide `lsof` sweep on the backend, so this matches
 * the shell-count badges rather than beating them: a dev server that came up
 * seconds ago is still news. React Query skips the interval while the document
 * is hidden — note that a visible-but-unfocused window keeps polling — and the
 * backend caches each scan, so several clients share one process sweep.
 */
const PORT_POLL_INTERVAL_MS = 10_000;

/**
 * Ports currently held open by each feature's own terminal and agent processes,
 * keyed by feature id. One shared query serves every project section.
 */
export function useFeaturePorts(): Map<number, readonly AllocatedPort[]> {
  const portsQuery = useListFeaturePorts({
    query: { refetchInterval: PORT_POLL_INTERVAL_MS },
  });

  useEffect(() => {
    if (!portsQuery.error) return;
    toast.error(apiErrorMessage(portsQuery.error, "Failed to detect allocated ports"), {
      id: "sidebar-ports-load-error",
    });
  }, [portsQuery.error]);

  return useMemo(() => {
    const byFeatureId = new Map<number, readonly AllocatedPort[]>();
    for (const entry of portsQuery.data ?? []) {
      if (entry.ports.length > 0) byFeatureId.set(entry.feature_id, entry.ports);
    }
    return byFeatureId;
  }, [portsQuery.data]);
}
