import { describe, expect, it } from "vitest";

import { keywordConfidence, looseTsQuery, reciprocalRankFusion } from "./retrieve";

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

// Research questions are questions. websearch_to_tsquery ANDs its terms, so a
// full question matches only a chunk containing every word — i.e. nothing.
describe("loosening a question into a keyword query", () => {
  it("ORs the significant terms and drops question filler", () => {
    const q = looseTsQuery("How large and fast-growing is the EU SaaS market?");
    expect(q).toContain(" or ");
    expect(q).toContain("saas");
    expect(q).toContain("market");
    expect(q).not.toContain("how");
    expect(q).not.toContain("the");
  });

  it("keeps hyphenated and numeric terms, which are exactly what embeddings miss", () => {
    const q = looseTsQuery("What was ARR in 2024 for partner-led entry?");
    expect(q).toContain("2024");
    expect(q).toContain("partner-led");
    expect(q).toContain("arr");
  });

  it("does not repeat a term", () => {
    expect(looseTsQuery("market market market")).toBe("market");
  });

  it("returns nothing when the query is all filler", () => {
    expect(looseTsQuery("what is the")).toBe("");
  });
});

// The bug this guards: hybrid used to report the vector score for every hit, so
// a chunk keyword search ranked first still arrived with its weak embedding
// score and got cut by the evidence floor.
describe("keyword rank confidence", () => {
  it("credits the top keyword hit enough to clear the evidence bar", () => {
    expect(keywordConfidence(0)).toBeGreaterThan(0.45);
  });

  it("decays with rank so the tail does not qualify as evidence", () => {
    expect(keywordConfidence(0)).toBeGreaterThan(keywordConfidence(3));
    expect(keywordConfidence(8)).toBeLessThan(0.45);
  });

  it("never goes negative", () => {
    expect(keywordConfidence(100)).toBe(0);
  });
});
