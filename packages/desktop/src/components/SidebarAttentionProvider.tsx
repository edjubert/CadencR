import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { ProjectAttentionBadges } from "@/components/ProjectAttentionBadges";
import { useResolvedAttention } from "@/hooks/useResolvedAttention";
import { useSidebarOption } from "@/stores/sidebar-config-store";

type SidebarAttention = ReturnType<typeof useResolvedAttention>;

/** Outside the app shell (a sidebar part rendered alone), nothing needs attention. */
const NO_ATTENTION: SidebarAttention = {
  entries: [],
  items: [],
  queue: [],
  byProject: new Map(),
  loadingStates: [],
};

export const SidebarAttentionContext = createContext<SidebarAttention>(NO_ATTENTION);

/**
 * Resolves the attention index once for the sidebar and the collapsed rail: the
 * "For me" block, the rail and every collapsed project's badges read the same
 * result.
 */
export function SidebarAttentionProvider({ children }: { children: ReactNode }): ReactElement {
  const attention = useResolvedAttention();
  return (
    <SidebarAttentionContext.Provider value={attention}>
      {children}
    </SidebarAttentionContext.Provider>
  );
}

export function useSidebarAttention(): SidebarAttention {
  return useContext(SidebarAttentionContext);
}

/**
 * A collapsed project's aggregated badges (G2). Hidden while the row is hovered
 * or focused, where the row actions take the same spot.
 */
export function ProjectRowAttention({ projectId }: { projectId: number }): ReactElement | null {
  const mode = useSidebarOption("projectBadges");
  const { byProject } = useSidebarAttention();
  if (mode === "none") return null;
  return (
    <ProjectAttentionBadges
      counts={byProject.get(projectId)}
      mode={mode}
      className="ml-auto can-hover:group-hover/project:hidden can-hover:group-focus-visible/project:hidden"
    />
  );
}
