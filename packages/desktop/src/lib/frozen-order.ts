import { intArraysEqual } from "@/lib/utils";

/**
 * Merge freshly fetched ids into a frozen display order: existing ids keep
 * their place, new ids go on top, removed ids drop out. Returns `previous`
 * itself when nothing changed so consumers can bail out of re-renders.
 */
export function reconcileFrozenOrder(
  previous: readonly number[],
  fetched: readonly number[],
): readonly number[] {
  const fetchedSet = new Set(fetched);
  const known = new Set(previous);
  const next = [
    ...fetched.filter((id) => !known.has(id)),
    ...previous.filter((id) => fetchedSet.has(id)),
  ];
  return intArraysEqual(next, previous) ? previous : next;
}
