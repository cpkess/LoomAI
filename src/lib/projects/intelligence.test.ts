import { describe, expect, it } from "vitest";

import { emergingThemes, knowledgeGaps, suggestedInvestigations, type EdgeLite, type ItemLite } from "./intelligence";

function item(over: Partial<ItemLite>): ItemLite {
  return { id: "1", type: "claim", status: "active", content: "c", ...over };
}

describe("emergingThemes", () => {
  it("clusters live items linked by positive relations", () => {
    const items = [
      item({ id: "a", content: "A" }),
      item({ id: "b", content: "B" }),
      item({ id: "c", content: "C" }),
      item({ id: "d", content: "D" }),
    ];
    const edges: EdgeLite[] = [
      { fromItemId: "a", toItemId: "b", relation: "supports" },
      { fromItemId: "b", toItemId: "c", relation: "refines" },
    ];
    const themes = emergingThemes(items, edges);
    expect(themes).toHaveLength(1);
    expect(themes[0].size).toBe(3);
    expect(themes[0].itemIds.sort()).toEqual(["a", "b", "c"]);
    // B is the most-connected member, so it labels the theme.
    expect(themes[0].label).toBe("B");
  });

  it("ignores contradictions and non-live items", () => {
    const items = [item({ id: "a" }), item({ id: "b", status: "resolved" })];
    const edges: EdgeLite[] = [{ fromItemId: "a", toItemId: "b", relation: "contradicts" }];
    expect(emergingThemes(items, edges)).toEqual([]);
  });
});

describe("knowledgeGaps", () => {
  it("flags open questions and thin-evidence claims", () => {
    const items = [
      item({ id: "q", type: "question", content: "What is X?" }),
      item({ id: "c1", type: "claim", content: "well-supported" }),
      item({ id: "c2", type: "claim", content: "thin" }),
      item({ id: "i", type: "insight", content: "insights need no evidence gate" }),
    ];
    const evidence = new Map([
      ["c1", 3],
      ["c2", 1],
    ]);
    const gaps = knowledgeGaps(items, evidence);
    expect(gaps.map((g) => g.itemId).sort()).toEqual(["c2", "q"]);
    expect(gaps.find((g) => g.itemId === "q")!.kind).toBe("open_question");
    expect(gaps.find((g) => g.itemId === "c2")!.kind).toBe("thin_evidence");
  });
});

describe("suggestedInvestigations", () => {
  it("prioritizes contradictions, then gaps, de-duplicated", () => {
    const items = [item({ id: "x", status: "challenged", content: "disputed" })];
    const gaps = knowledgeGaps(
      [item({ id: "q", type: "question", content: "open?" })],
      new Map()
    );
    const out = suggestedInvestigations(items, gaps);
    expect(out[0]).toEqual({ reason: "resolve_contradiction", content: "disputed" });
    expect(out.some((i) => i.reason === "answer_question" && i.content === "open?")).toBe(true);
  });
});
