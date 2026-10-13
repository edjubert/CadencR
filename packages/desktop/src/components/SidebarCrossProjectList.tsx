import { useMemo, type ReactElement } from "react";
import { useListProjects, type Project } from "@/api/generated";
import { SidebarLensList } from "@/components/SidebarLensList";
import { useCrossProjectConversations } from "@/hooks/useCrossProjectConversations";
import { buildSidebarGroups, showsGroupHeaders, type SidebarListMode } from "@/lib/sidebar-views";
import { useSidebarOption } from "@/stores/sidebar-config-store";

const NO_PROJECTS: Project[] = [];

/** Below the blocks, in place of the project tree: a cross-project lens's groups, or a saved view's matches. */
export function SidebarCrossProjectList({
  mode,
  activeFeatureId,
  onSelectFeature,
}: {
  mode: Exclude<SidebarListMode, { kind: "tree" }>;
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}): ReactElement {
  const { features, activity, context, isPending } = useCrossProjectConversations("sidebar");
  const sort = useSidebarOption("conversationSort");
  const { data: projects = NO_PROJECTS } = useListProjects();
  const groups = useMemo(
    () => buildSidebarGroups(features, mode, sort, projects, context),
    [context, features, mode, projects, sort],
  );
  return (
    <SidebarLensList
      groups={groups}
      showHeaders={showsGroupHeaders(mode)}
      activity={activity}
      isPending={isPending}
      emptyText={
        mode.kind === "view" ? "No conversation matches this view" : "No conversations yet"
      }
      activeFeatureId={activeFeatureId}
      onSelectFeature={onSelectFeature}
    />
  );
}
