import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useListFeatureActivity } from "@/api/generated";
import { showBrowserError } from "@/components/browser/browser-errors";
import { apiErrorMessage } from "@/lib/api-errors";
import { desktopBridge, isDesktopShell } from "@/lib/desktop-bridge";
import { useBrowserStore } from "@/stores/browser-store";

interface FeatureActivityCounts {
  shellCountsByFeatureId: Map<number, number>;
  browserCountsByFeatureId: Record<number, number>;
  downloadCountsByFeatureId: Record<number, number>;
}

export function useFeatureActivityCounts(projectId: number): FeatureActivityCounts {
  // Archived rows still surface a shell badge and the "Close N shells"
  // affordance — archiving a feature doesn't kill its shells by default — so we
  // must keep `include_archived: true` to see those PTYs. The win here is the
  // interval: shell-count badges are a secondary signal, so a slow 10s poll
  // (down from 2s) is plenty, and React Query already pauses it while the window
  // is unfocused, so an idle background window makes no requests at all.
  const activityQuery = useListFeatureActivity(
    { project_id: projectId, include_archived: true },
    { query: { refetchInterval: 10_000 } },
  );
  const browserCountsByFeatureId = useBrowserStore((state) => state.countsByScope);
  const downloadCountsByFeatureId = useBrowserStore((state) => state.activeDownloadCountsByScope);

  useEffect(() => {
    if (!activityQuery.error) return;
    toast.error(apiErrorMessage(activityQuery.error, "Failed to load sidebar activity"), {
      id: "sidebar-activity-load-error",
    });
  }, [activityQuery.error]);

  useEffect(() => {
    if (!isDesktopShell()) return;
    let alive = true;
    let downloadRevision = 0;
    void desktopBridge
      .listBrowserTabCountsByScope()
      .then((counts) => {
        if (alive) useBrowserStore.getState().setCountsByScope(counts);
      })
      .catch((error: unknown) => {
        showBrowserError(error, "Failed to load browser tab counts");
      });
    const unsubscribe = desktopBridge.onBrowserTabCounts((counts) => {
      useBrowserStore.getState().setCountsByScope(counts);
    });
    const initialDownloadRevision = downloadRevision;
    const unsubscribeDownloads = desktopBridge.onBrowserDownloadCounts((counts) => {
      downloadRevision += 1;
      useBrowserStore.getState().setActiveDownloadCountsByScope(counts);
    });
    void desktopBridge
      .listBrowserDownloadCountsByScope()
      .then((counts) => {
        if (alive && downloadRevision === initialDownloadRevision) {
          useBrowserStore.getState().setActiveDownloadCountsByScope(counts);
        }
      })
      .catch((error: unknown) => {
        if (alive && downloadRevision === initialDownloadRevision) {
          showBrowserError(error, "Failed to load browser download counts");
        }
      });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeDownloads();
    };
  }, []);

  const shellCountsByFeatureId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of activityQuery.data ?? []) {
      counts.set(item.feature_id, item.shell_count);
    }
    return counts;
  }, [activityQuery.data]);

  return useMemo(
    () => ({ shellCountsByFeatureId, browserCountsByFeatureId, downloadCountsByFeatureId }),
    [browserCountsByFeatureId, downloadCountsByFeatureId, shellCountsByFeatureId],
  );
}
