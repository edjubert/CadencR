import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProjectSettingsQueryKey,
  useGetProjectSettings,
  useSetProjectSetting,
  type ProjectSetting,
} from "@/api/generated";
import { DEFAULT_PROJECT_COLOR } from "@/lib/project-colors";
import { useSidebarSample } from "@/lib/sidebar-sample-context";

/**
 * Returns the persisted color for a project (or the default if unset).
 *
 * The settings list is fetched once per project per session — `staleTime:
 * Infinity` keeps color dots from triggering a fresh GET on every project-tree
 * mount. The companion `useSetProjectColor` mutation invalidates the same
 * query so a manual color change refetches.
 */
export function useProjectColor(projectId: number): string {
  const sample = useSidebarSample();
  const settings = useProjectSettingsList(projectId);
  if (sample) return sample.projectColors.get(projectId) ?? DEFAULT_PROJECT_COLOR;
  const colorSetting = settings?.find((s) => s.key === "color");
  return colorSetting?.value ?? DEFAULT_PROJECT_COLOR;
}

/**
 * The project's settings list, shared by its color and icon. The display
 * options preview's sample projects don't exist on the service: no fetch there.
 */
export function useProjectSettingsList(projectId: number): ProjectSetting[] | undefined {
  const sample = useSidebarSample();
  const { data } = useGetProjectSettings(projectId, {
    query: { staleTime: Infinity, enabled: sample === null },
  });
  return data;
}

/**
 * Mutation hook for changing the persisted color. Mirrors the orval-generated
 * `useSetProjectSetting` but invalidates the project-settings query on success
 * so the color dots refresh — the global 30 s `staleTime` would otherwise
 * keep the stale dot visible for half a minute.
 */
export function useSetProjectColor(): ReturnType<typeof useSetProjectSetting> {
  const queryClient = useQueryClient();
  return useSetProjectSetting({
    mutation: {
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: getGetProjectSettingsQueryKey(variables.id),
        });
      },
    },
  });
}
