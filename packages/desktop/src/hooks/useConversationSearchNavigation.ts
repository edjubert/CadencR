import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ConversationSearchSnapshot,
  type ConversationMatchIdentity,
} from "@/lib/conversation-search/incremental-index";
import type { ConversationMatch } from "@/lib/conversation-search/matches";

interface NavigationState {
  query: string;
  ordinal: number;
  identity: ConversationMatchIdentity | null;
}

export interface ConversationSearchNavigation {
  activeMatch: ConversationMatch | null;
  activeNumber: number;
  next: () => void;
  prev: () => void;
  reset: () => void;
}

const INITIAL_NAVIGATION: NavigationState = { query: "", ordinal: 0, identity: null };

function sameIdentity(
  left: ConversationMatchIdentity | null,
  right: ConversationMatchIdentity | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.block === right.block &&
    left.rowKey === right.rowKey &&
    left.blockIndexInRow === right.blockIndexInRow &&
    left.occurrenceInBlock === right.occurrenceInBlock
  );
}

/** Keep navigation stable across append/prepend/reorder while exposing stable callbacks. */
export function useConversationSearchNavigation(
  snapshot: ConversationSearchSnapshot,
  query: string,
): ConversationSearchNavigation {
  const [navigation, setNavigation] = useState<NavigationState>(INITIAL_NAVIGATION);
  const queryChanged = navigation.query !== query;
  const preservedOrdinal = queryChanged
    ? null
    : navigation.identity && snapshot.ordinalOf(navigation.identity);
  const preferredOrdinal = preservedOrdinal ?? (queryChanged ? 0 : navigation.ordinal);
  const ordinal =
    snapshot.matchCount === 0 ? -1 : Math.min(preferredOrdinal, snapshot.matchCount - 1);
  const activeMatch = useMemo(() => snapshot.matchAt(ordinal), [ordinal, snapshot]);
  const activeIdentity = useMemo(() => snapshot.identityAt(ordinal), [ordinal, snapshot]);
  const snapshotRef = useRef(snapshot);

  useLayoutEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    setNavigation((current) => {
      const nextOrdinal = Math.max(ordinal, 0);
      if (
        current.query === query &&
        current.ordinal === nextOrdinal &&
        sameIdentity(current.identity, activeIdentity)
      ) {
        return current;
      }
      return { query, ordinal: nextOrdinal, identity: activeIdentity };
    });
  }, [
    activeIdentity?.block,
    activeIdentity?.blockIndexInRow,
    activeIdentity?.occurrenceInBlock,
    activeIdentity?.rowKey,
    ordinal,
    query,
  ]);

  const step = useCallback((delta: number): void => {
    const snapshot = snapshotRef.current;
    const count = snapshot.matchCount;
    if (count === 0) return;
    setNavigation((state) => {
      const preservedOrdinal = state.identity ? snapshot.ordinalOf(state.identity) : null;
      const currentOrdinal = preservedOrdinal ?? Math.min(state.ordinal, count - 1);
      const nextOrdinal = (currentOrdinal + delta + count) % count;
      return { ...state, ordinal: nextOrdinal, identity: snapshot.identityAt(nextOrdinal) };
    });
  }, []);
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  const reset = useCallback(() => setNavigation(INITIAL_NAVIGATION), []);

  return useMemo(
    () => ({
      activeMatch,
      activeNumber: ordinal < 0 ? 0 : ordinal + 1,
      next,
      prev,
      reset,
    }),
    [activeMatch, next, ordinal, prev, reset],
  );
}
