import { describe, expect, it } from "vitest";
import { reconcileFrozenOrder } from "./frozen-order";

describe("reconcileFrozenOrder", () => {
  it("keeps existing ids in place, puts new ones on top, drops removed ones", () => {
    expect(reconcileFrozenOrder([1, 2, 3], [2, 4, 1])).toEqual([4, 1, 2]);
  });

  it("returns the previous array when nothing changed", () => {
    const previous = [1, 2, 3];
    expect(reconcileFrozenOrder(previous, [3, 2, 1])).toBe(previous);
  });
});
