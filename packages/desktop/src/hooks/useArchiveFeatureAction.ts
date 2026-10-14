import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useArchiveFeature,
  type ArchiveRequest,
  type ArchiveResponse,
  type Feature,
} from "@/api/generated";
import {
  archiveNavigationTarget,
  archiveFeaturesInCachedLists,
  closeFeatureSession,
  navigateToFeatureOrHome,
} from "@/components/project-feature-navigation";
import { invalidateByUrlPrefix } from "@/lib/queryClient";

export type ArchiveFeatureOptions = Required<ArchiveRequest>;

interface UseArchiveFeatureActionOptions {
  activeFeatureId: number | null;
  activeFeatures: readonly Feature[];
  projectId: number | null;
}

export function useArchiveFeatureAction({
  activeFeatureId,
  activeFeatures,
  projectId,
}: UseArchiveFeatureActionOptions) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mutation = useArchiveFeature({
    mutation: {
      onSuccess: (response) => {
        const archivedIds = new Set(response.archived_ids);
        archiveFeaturesInCachedLists(queryClient, response.archived_ids);
        for (const featureId of response.archived_ids) closeFeatureSession(featureId);
        void invalidateByUrlPrefix(queryClient, "/api/features");
        if (projectId == null) return;
        const target = archiveNavigationTarget(activeFeatures, activeFeatureId, archivedIds);
        if (target === undefined) return;
        navigateToFeatureOrHome(navigate, projectId, target ?? undefined);
      },
    },
  });
  const { mutateAsync } = mutation;
  return useCallback(
    (featureId: number, options: ArchiveFeatureOptions): Promise<ArchiveResponse> =>
      mutateAsync({ id: featureId, data: options }),
    [mutateAsync],
  );
}
