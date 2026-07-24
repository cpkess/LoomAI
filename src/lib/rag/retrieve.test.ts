import { describe, expect, it } from "vitest";

import { reciprocalRankFusion } from "./retrieve";

const id = (s: { k: string }) => s.k;

describe("reciprocal rank fusion", () => {
  it("ranks what both searches agree on above what only one found", () => {
    // "b" is mid-ranked in both lists; "a" and "x" each top exactly one.
    const vector = [{ k: "a" }, { k: "b" }, { k: "c" }];
    const keyword = [{ k: "x" }, { k: "b" }, { k: "y" }];
    expect(reciprocalRankFusion([vector, keyword], id)[0].item.k).toBe("b");
  });

  it("keeps items only one search found", () => {
    const fused = reciprocalRankFusion([[{ k: "a" }], [{ k: "z" }]], id);
    expect(fused.map((f) => f.item.k).sort()).toEqual(["a", "z"]);
  });

  it("preserves order within a single list", () => {
    const fused = reciprocalRankFusion([[{ k: "a" }, { k: "b" }, { k: "c" }]], id);
    expect(fused.map((f) => f.item.k)).toEqual(["a", "b", "c"]);
  });

  it("never double-counts the same item from one list", () => {
    const single = reciprocalRankFusion([[{ k: "a" }]], id)[0].score;
    const both = reciprocalRankFusion([[{ k: "a" }], [{ k: "a" }]], id)[0].score;
    expect(both).toBeCloseTo(single * 2);
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([], id)).toEqual([]);
    expect(reciprocalRankFusion([[], []], id)).toEqual([]);
  });

  it("damps rank influence with k, so agreement outweighs a single top hit", () => {
    // With a small k, first place is worth a lot more than second.
    const sharp = reciprocalRankFusion([[{ k: "top" }], [{ k: "both" }, { k: "top" }]], id, 1);
    const flat = reciprocalRankFusion([[{ k: "top" }], [{ k: "both" }, { k: "top" }]], id, 60);
    expect(sharp[0].item.k).toBe("top"); // one strong first place wins
    expect(flat[0].item.k).toBe("top");
    // But the gap narrows as k grows.
    const sharpGap = sharp[0].score - sharp[1].score;
    const flatGap = flat[0].score - flat[1].score;
    expect(flatGap).toBeLessThan(sharpGap);
  });
});
