import { create } from "zustand";
import type { SidebarOptionId } from "@/lib/sidebar-config";

interface SidebarPreviewState {
  /** The display options popover is open: the sidebar shows sample conversations. */
  optionsOpen: boolean;
  /** Asked for the real conversations instead, until the app restarts. */
  showMine: boolean;
  /** The option under the pointer or focus in the display options: the sidebar outlines what it changes. */
  highlight: SidebarOptionId | null;
  setOptionsOpen: (open: boolean) => void;
  setShowMine: (showMine: boolean) => void;
  setHighlight: (option: SidebarOptionId | null) => void;
}

export const useSidebarPreviewStore = create<SidebarPreviewState>((set) => ({
  optionsOpen: false,
  showMine: false,
  highlight: null,
  setOptionsOpen: (optionsOpen) =>
    set(optionsOpen ? { optionsOpen } : { optionsOpen, highlight: null }),
  setShowMine: (showMine) => set({ showMine }),
  setHighlight: (highlight) =>
    set((state) => (state.highlight === highlight ? state : { highlight })),
}));

/** Whether the sidebar shows the sample conversations in place of the real ones. */
export function useSidebarShowsSamples(): boolean {
  return useSidebarPreviewStore((state) => state.optionsOpen && !state.showMine);
}
