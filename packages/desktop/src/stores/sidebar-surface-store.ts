import { createContext, useContext, useMemo } from "react";
import { create } from "zustand";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSidebarSample } from "@/lib/sidebar-sample-context";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";

/**
 * Where a sidebar row is rendered: the project tree (and Pinned), "For me",
 * "In progress", "Recent", the rail.
 */
export type SidebarSurface = "tree" | "for-me" | "working" | "recent" | "rail";

/** The foldable blocks above the project list, named after their surface. */
export type SidebarFoldableBlock = SidebarSurfaceBlock | "pinned";

/** Foldable blocks whose rows live on a sidebar surface (not the tree's). */
export type SidebarSurfaceBlock = Extract<SidebarSurface, "for-me" | "working" | "recent">;

interface SidebarSurfaceState {
  /** Which blocks are unfolded (each folds from its header); all start open. */
  expanded: Readonly<Record<SidebarFoldableBlock, boolean>>;
  toggleBlock: (block: SidebarFoldableBlock) => void;
}

export const useSidebarSurfaceStore = create<SidebarSurfaceState>((set) => ({
  expanded: { "for-me": true, working: true, recent: true, pinned: true },
  toggleBlock: (block) =>
    set((state) => ({ expanded: { ...state.expanded, [block]: !state.expanded[block] } })),
}));

/** A block's fold state and its toggle. */
export function useSidebarBlockFold(block: SidebarFoldableBlock): {
  expanded: boolean;
  toggle: () => void;
} {
  const expanded = useSidebarSurfaceStore((state) => state.expanded[block]);
  const toggleBlock = useSidebarSurfaceStore((state) => state.toggleBlock);
  return useMemo(
    () => ({ expanded, toggle: () => toggleBlock(block) }),
    [block, expanded, toggleBlock],
  );
}

export const SidebarSurfaceContext = createContext<SidebarSurface>("tree");

/**
 * The surface whose rows auto-open a waiting conversation's gate popover. A
 * conversation can show in the rail, "For me" and the tree at once, and only
 * the most prominent one opens: the rail when the sidebar is collapsed behind a
 * conversation rail, else "For me" when it is on screen, else the tree. A
 * collapsed sidebar without a conversation rail opens none: its rows are off
 * screen. Derived from state rather than registered by effects, so every row
 * agrees in the very render a request appears (a popover opening on one
 * surface then closing would steal focus from the one that should stay open).
 */
function useGateAutoOpenOwner(): SidebarSurface | null {
  const { collapsed } = useSidebarCollapsed();
  const isMobile = useIsMobile();
  const rail = useSidebarOption("rail");
  const forMe = useSidebarOption("forMe");
  const filtering = useSidebarFilterQuery() !== "";
  const forMeExpanded = useSidebarSurfaceStore((state) => state.expanded["for-me"]);
  if (collapsed && !isMobile) {
    return rail === "conversations" || rail === "attention" ? "rail" : null;
  }
  return openSidebarGateOwner(forMe && forMeExpanded, filtering);
}

/** While the sidebar is open: For me's rows when it is shown and unfolded, else the tree's. */
export function openSidebarGateOwner(forMeShown: boolean, filtering: boolean): SidebarSurface {
  return forMeShown && !filtering ? "for-me" : "tree";
}

/** Whether rows on the caller's surface own the gate popover's auto-open. */
export function useOwnsGateAutoOpen(): boolean {
  const surface = useContext(SidebarSurfaceContext);
  const owner = useGateAutoOpenOwner();
  const sample = useSidebarSample();
  return (sample ? sample.gateOwner : owner) === surface;
}
