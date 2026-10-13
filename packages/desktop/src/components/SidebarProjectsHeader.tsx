import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarDisplayOptionsPopover } from "@/components/SidebarDisplayOptionsPopover";
import { SECTION_DIVIDER_CLASS } from "@/components/SidebarBlock";
import { SidebarLensMenu } from "@/components/SidebarLensMenu";
import { cn } from "@/lib/utils";

interface SidebarProjectsHeaderProps {
  onAddProject: () => void;
  isAddingProject: boolean;
  canAddProject: boolean;
  /** Omitted when there is nothing to re-sort (projects sorted live or by name, or not shown). */
  onRefresh?: () => void;
  isRefreshing: boolean;
}

/**
 * "Projects" sidebar header: section label plus the display options, the
 * add-project and re-sort (manual refresh) actions. Refresh re-adopts the backend's
 * most-recent-user-message ordering for projects (see `useOrderedProjects`).
 */
const HOVER_REVEAL_CLASS =
  "can-hover:opacity-0 can-hover:transition-opacity can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100";

export function SidebarProjectsHeader({
  onAddProject,
  isAddingProject,
  canAddProject,
  onRefresh,
  isRefreshing,
}: SidebarProjectsHeaderProps) {
  return (
    <div className={cn("group flex items-center justify-between px-2", SECTION_DIVIDER_CLASS)}>
      <SidebarLensMenu />
      <div className="flex items-center gap-0.5">
        <SidebarDisplayOptionsPopover className={HOVER_REVEAL_CLASS} />
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Re-sort projects"
            aria-label="Re-sort projects"
            className={HOVER_REVEAL_CLASS}
          >
            <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          </Button>
        )}
        {canAddProject ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onAddProject}
            disabled={isAddingProject}
            title="Add project"
            aria-label="Add project"
            className={HOVER_REVEAL_CLASS}
          >
            <Plus />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
