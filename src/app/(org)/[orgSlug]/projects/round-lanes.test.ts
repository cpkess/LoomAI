import { describe, expect, it } from "vitest";

import { layoutRounds } from "./round-lanes";

import type { RoundNode } from "./round-lanes";

const round = (over: Partial<RoundNode> & { id: string; round: number }): RoundNode => ({
  parentId: null,
  mergedFrom: [],
  ...over,
});

describe("round lane layout", () => {
  it("indents a child under its parent", () => {
    const laid = layoutRounds([round({ id: "b", round: 2, parentId: "a" }), round({ id: "a", round: 1 })]);
    expect(laid.map((l) => [l.round.id, l.depth])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("puts siblings at the same depth, in round order", () => {
    const laid = layoutRounds([
      round({ id: "a", round: 1 }),
      round({ id: "c", round: 3, parentId: "a" }),
      round({ id: "b", round: 2, parentId: "a" }),
    ]);
    expect(laid.map((l) => l.round.id)).toEqual(["a", "b", "c"]);
    expect(laid.map((l) => l.depth)).toEqual([0, 1, 1]);
  });

  it("nests a deeper chain", () => {
    const laid = layoutRounds([
      round({ id: "a", round: 1 }),
      round({ id: "b", round: 2, parentId: "a" }),
      round({ id: "c", round: 3, parentId: "b" }),
    ]);
    expect(laid.map((l) => l.depth)).toEqual([0, 1, 2]);
  });

  // A comparison hangs off its newest parent so the tree stays a tree.
  it("places a merge under its primary parent", () => {
    const laid = layoutRounds([
      round({ id: "a", round: 1 }),
      round({ id: "b", round: 2, parentId: "a" }),
      round({ id: "m", round: 3, parentId: "b", mergedFrom: ["a", "b"] }),
    ]);
    expect(laid.map((l) => [l.round.id, l.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["m", 2],
    ]);
  });

  it("shows an orphan as a root rather than dropping it", () => {
    const laid = layoutRounds([round({ id: "a", round: 1 }), round({ id: "x", round: 2, parentId: "deleted" })]);
    expect(laid).toHaveLength(2);
    expect(laid.every((l) => l.depth === 0)).toBe(true);
  });

  it("handles an empty history", () => {
    expect(layoutRounds([])).toEqual([]);
  });
});
