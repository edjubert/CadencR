/**
 * Tracks which features have an unread agent completion: the agent finished
 * its turn (agent → idle) while the user was NOT viewing that feature. The
 * sidebar renders a green check for these; it clears the moment the conversation
 * is opened.
 *
 * Per-client and in-memory by design — "unread" is relative to *this* window
 * (a remote phone and the host each track their own), and there is nothing to
 * restore on reload: a fresh load has read nothing, so it shows no unread checks.
 *
 * Conforms to frontend-performance.md: consumers read the per-feature boolean
 * via `useIsFeatureUnread`, never the whole map.
 */
import { useEffect } from "react";
import { create } from "zustand";

interface UnreadState {
  /** Feature IDs with an unread agent completion (value is always `true`). */
  byFeature: Record<number, true>;
  /** Flag a completed-but-unviewed agent turn for a feature. */
  markUnread: (featureId: number) => void;
  /** Clear the unread flag for a feature (e.g. when its conversation opens). */
  markRead: (featureId: number) => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  byFeature: {},
  markUnread: (featureId) =>
    set((s) => (s.byFeature[featureId] ? s : { byFeature: { ...s.byFeature, [featureId]: true } })),
  markRead: (featureId) =>
    set((s) => {
      if (!s.byFeature[featureId]) return s;
      const next = { ...s.byFeature };
      delete next[featureId];
      return { byFeature: next };
    }),
}));

/**
 * Narrow per-feature subscription: re-renders the consumer only when *this*
 * feature's unread flag flips — safe to call in the memoized sidebar row.
 */
export function useIsFeatureUnread(featureId: number): boolean {
  return useUnreadStore((s) => s.byFeature[featureId] === true);
}

/**
 * Clear the unread flag whenever `featureId` is the open conversation. Called
 * at the ws-session route level so opening a feature (by click, keyboard, or
 * notification) reads it on every device.
 */
export function useMarkFeatureRead(featureId: number | null | undefined): void {
  const markRead = useUnreadStore((s) => s.markRead);
  useEffect(() => {
    if (featureId != null) markRead(featureId);
  }, [featureId, markRead]);
}
