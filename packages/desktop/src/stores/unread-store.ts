/**
 * Tracks which features have something the user has not seen yet:
 * - unread: the agent finished its turn (agent → idle) while the user was NOT
 *   viewing that feature, or the user marked it unread by hand;
 * - failed: the turn stopped on an error while nobody was looking.
 * The sidebar renders a green check for unread and a strong error mark for
 * failed; both clear the moment the conversation is opened.
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
import type { FeatureMark } from "@/lib/sidebar-attention";

interface UnreadState {
  /** Feature IDs with an unread agent completion (value is always `true`). */
  byFeature: Record<number, true>;
  /** Feature IDs whose last turn failed off-screen (value is always `true`). */
  failedByFeature: Record<number, true>;
  /**
   * When each marked feature was first marked, as an increasing counter: the
   * "For me" block lists the oldest first.
   */
  markedOrder: Record<number, number>;
  /** Flag a completed-but-unviewed agent turn (or a hand-marked conversation). */
  markUnread: (featureId: number) => void;
  /** Flag a failed-but-unviewed agent turn. */
  markFailed: (featureId: number) => void;
  /** Drop the failure flag once the conversation works again. */
  clearFailed: (featureId: number) => void;
  /** Clear every flag for a feature (e.g. when its conversation opens). */
  markRead: (featureId: number) => void;
  /** Mark as read when flagged, as unread otherwise (the row's menu and shortcut). */
  toggleMarked: (featureId: number) => void;
}

type MarkFlags = Pick<UnreadState, "byFeature" | "failedByFeature">;

export function featureMark(state: MarkFlags, featureId: number): FeatureMark {
  if (state.failedByFeature[featureId]) return "failed";
  return state.byFeature[featureId] ? "unread" : "none";
}

let nextMark = 0;

function withOrder(order: Record<number, number>, featureId: number): Record<number, number> {
  return featureId in order ? order : { ...order, [featureId]: ++nextMark };
}

function without<T>(record: Record<number, T>, featureId: number): Record<number, T> {
  if (!(featureId in record)) return record;
  const next = { ...record };
  delete next[featureId];
  return next;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  byFeature: {},
  failedByFeature: {},
  markedOrder: {},
  markUnread: (featureId) =>
    set((s) =>
      s.byFeature[featureId]
        ? s
        : {
            byFeature: { ...s.byFeature, [featureId]: true },
            markedOrder: withOrder(s.markedOrder, featureId),
          },
    ),
  markFailed: (featureId) =>
    set((s) =>
      s.failedByFeature[featureId]
        ? s
        : {
            failedByFeature: { ...s.failedByFeature, [featureId]: true },
            markedOrder: withOrder(s.markedOrder, featureId),
          },
    ),
  clearFailed: (featureId) =>
    set((s) => {
      if (!s.failedByFeature[featureId]) return s;
      return {
        failedByFeature: without(s.failedByFeature, featureId),
        markedOrder: s.byFeature[featureId] ? s.markedOrder : without(s.markedOrder, featureId),
      };
    }),
  markRead: (featureId) =>
    set((s) => {
      if (!s.byFeature[featureId] && !s.failedByFeature[featureId]) return s;
      return {
        byFeature: without(s.byFeature, featureId),
        failedByFeature: without(s.failedByFeature, featureId),
        markedOrder: without(s.markedOrder, featureId),
      };
    }),
  toggleMarked: (featureId) => {
    const state = get();
    if (featureMark(state, featureId) === "none") state.markUnread(featureId);
    else state.markRead(featureId);
  },
}));

/**
 * Narrow per-feature subscription: re-renders the consumer only when *this*
 * feature's unread flag flips — safe to call in the memoized sidebar row.
 */
export function useIsFeatureUnread(featureId: number): boolean {
  return useUnreadStore((s) => s.byFeature[featureId] === true);
}

/** Whether the feature has an unread reply or an unseen failure. */
export function useIsFeatureMarked(featureId: number): boolean {
  return useUnreadStore((s) => featureMark(s, featureId) !== "none");
}

/**
 * Clear the unread flag whenever `featureId` is the open conversation. Called
 * at the ws-session route level so opening a feature (by click, keyboard, or
 * notification) reads it on every device. Runs once per opening: marking the
 * open conversation unread by hand sticks until it is opened again.
 */
export function useMarkFeatureRead(featureId: number | null | undefined): void {
  const markRead = useUnreadStore((s) => s.markRead);
  useEffect(() => {
    if (featureId != null) markRead(featureId);
  }, [featureId, markRead]);
}
