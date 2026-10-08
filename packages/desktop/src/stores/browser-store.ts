import { create } from "zustand";
import type { BrowserStateSnapshot } from "@/shared/browser-types";

/**
 * Mirror of the main-process browser snapshot. The browser UI keeps its own
 * local view state, but a few cross-cutting consumers (the ⌘W app-close
 * fallback) need the live tab count outside the browser component tree, so the
 * bootstrap pushes every snapshot here.
 */
interface BrowserStore {
  snapshot: BrowserStateSnapshot | null;
  countsByScope: Record<number, number>;
  activeDownloadCountsByScope: Record<number, number>;
  setSnapshot: (snapshot: BrowserStateSnapshot) => void;
  setCountsByScope: (counts: Record<number, number>) => void;
  setActiveDownloadCountsByScope: (counts: Record<number, number>) => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  snapshot: null,
  countsByScope: {},
  activeDownloadCountsByScope: {},
  setSnapshot: (snapshot) => set({ snapshot }),
  setCountsByScope: (counts) =>
    set((state) =>
      countRecordsEqual(state.countsByScope, counts) ? state : { countsByScope: counts },
    ),
  setActiveDownloadCountsByScope: (counts) =>
    set((state) =>
      countRecordsEqual(state.activeDownloadCountsByScope, counts)
        ? state
        : { activeDownloadCountsByScope: counts },
    ),
}));

/** Number of open browser tabs, read synchronously (0 before the browser opens). */
export function browserTabCount(): number {
  return useBrowserStore.getState().snapshot?.tabs.length ?? 0;
}

function countRecordsEqual(a: Record<number, number>, b: Record<number, number>): boolean {
  const leftKeys = Object.keys(a);
  const rightKeys = Object.keys(b);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => a[Number(key)] === b[Number(key)])
  );
}
