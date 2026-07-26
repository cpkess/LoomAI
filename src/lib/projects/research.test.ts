import { describe, expect, it } from "vitest";

import {
  citationStats,
  dedupeEvidence,
  dedupeKey,
  evidenceBlock,
  extractCitations,
  fallbackPlan,
  gatherWeb,
  mergeBranches,
  mergeRounds,
  numberEvidence,
  rankEvidence,
  stripUnknownCitations,
  type WebDeps,
} from "./research";

import type { Organization } from "@/lib/db/schema";

type Candidate = Parameters<typeof rankEvidence>[0][number];

function candidate(over: Partial<Candidate> & { snippet: string; kind: string }): Candidate {
  return { source: "src", ref: null, url: null, score: 0.5, question: "q", ...over };
}

describe("evidence dedupe", () => {
  it("keys on meaning, not punctuation or case", () => {
    expect(dedupeKey("EU SaaS grew 22% in 2024!")).toBe(dedupeKey("eu saas grew 22  in 2024"));
  });

  it("collapses repeats and keeps the highest-scoring copy", () => {
    const deduped = dedupeEvidence([
      candidate({ snippet: "Pipeline has 40 leads", kind: "document", score: 0.4 }),
      candidate({ snippet: "Pipeline has 40 leads.", kind: "document", score: 0.9 }),
      candidate({ snippet: "Something else entirely", kind: "document", score: 0.6 }),
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((e) => e.snippet.startsWith("Pipeline"))?.score).toBe(0.9);
  });

  it("keeps the same text from different sources — two sources agreeing is worth more", () => {
    const deduped = dedupeEvidence([
      candidate({ snippet: "Market grew 22%", kind: "web", url: "https://a.example/x" }),
      candidate({ snippet: "Market grew 22%", kind: "web", url: "https://b.example/y" }),
    ]);
    expect(deduped).toHaveLength(2);
  });
});

describe("evidence ranking", () => {
  it("gives every channel a voice instead of letting the loudest fill the cap", () => {
    // Documents always score highest; a pure sort would return documents only.
    const items = [
      ...Array.from({ length: 6 }, (_, i) => candidate({ snippet: `doc ${i}`, kind: "document", score: 0.9 })),
      candidate({ snippet: "web finding", kind: "web", score: 0.7 }),
      candidate({ snippet: "known fact", kind: "knowledge", score: 0.6 }),
    ];
    const kinds = new Set(rankEvidence(items, 4).map((e) => e.kind));
    expect(kinds).toEqual(new Set(["document", "web", "knowledge"]));
  });

  it("respects the cap and stays score-ordered", () => {
    const items = Array.from({ length: 30 }, (_, i) => candidate({ snippet: `s${i}`, kind: "document", score: i / 30 }));
    const ranked = rankEvidence(items, 5);
    expect(ranked).toHaveLength(5);
    expect(ranked.map((e) => e.score)).toEqual([...ranked.map((e) => e.score)].sort((a, b) => (b ?? 0) - (a ?? 0)));
  });

  it("numbers evidence E1..En in rank order", () => {
    const numbered = numberEvidence([candidate({ snippet: "a", kind: "web" }), candidate({ snippet: "b", kind: "web" })]);
    expect(numbered.map((e) => e.id)).toEqual(["E1", "E2"]);
  });
});

// A follow-up round exists because the user asked for a different avenue, so
// what it finds must not be crowded out by well-scored evidence from before.
describe("merging a follow-up round with what came before", () => {
  const carried = [
    candidate({ snippet: "old but highly relevant", kind: "document", score: 0.95, source: "old.md" }),
    candidate({ snippet: "also old", kind: "document", score: 0.9, source: "old2.md" }),
  ];
  const fresh = [candidate({ snippet: "the new avenue", kind: "web", score: 0.6, url: "https://new.example/a" })];

  it("gives this round's findings first call on the budget", () => {
    const merged = mergeRounds(carried, fresh, 2);
    expect(merged[0].snippet).toBe("the new avenue");
    expect(merged).toHaveLength(2); // one carried item fills the remainder
  });

  it("keeps earlier evidence when there is room, so the answer still builds on it", () => {
    const merged = mergeRounds(carried, fresh, 5);
    expect(merged).toHaveLength(3);
    expect(merged.map((e) => e.snippet)).toContain("old but highly relevant");
  });

  it("drops carried evidence entirely when the new round fills the budget", () => {
    const many = Array.from({ length: 6 }, (_, i) => candidate({ snippet: `new ${i}`, kind: "web", score: 0.5 }));
    const merged = mergeRounds(carried, many, 3);
    expect(merged).toHaveLength(3);
    expect(merged.every((e) => e.snippet.startsWith("new"))).toBe(true);
  });

  it("does not list the same finding twice when a round re-discovers it", () => {
    const rediscovered = candidate({ snippet: "old but highly relevant", kind: "document", score: 0.7, source: "old.md" });
    const merged = mergeRounds(carried, [rediscovered], 5);
    expect(merged.filter((e) => e.snippet === "old but highly relevant")).toHaveLength(1);
  });

  it("behaves like a first round when there is nothing carried", () => {
    expect(mergeRounds([], fresh, 5)).toHaveLength(1);
  });
});

// Comparing two avenues only means something if both are actually represented.
describe("pooling evidence across branches", () => {
  const strong = Array.from({ length: 6 }, (_, i) => candidate({ snippet: `A${i}`, kind: "document", score: 0.9, source: "a.md" }));
  const weak = Array.from({ length: 6 }, (_, i) => candidate({ snippet: `B${i}`, kind: "web", score: 0.3, url: `https://b.example/${i}` }));

  it("does not let the better-sourced branch starve the other", () => {
    const merged = mergeBranches([strong, weak], 6);
    expect(merged.filter((e) => e.snippet.startsWith("A"))).toHaveLength(3);
    expect(merged.filter((e) => e.snippet.startsWith("B"))).toHaveLength(3);
  });

  it("takes each branch's best first", () => {
    const merged = mergeBranches([strong, weak], 2);
    expect(merged.map((e) => e.snippet)).toEqual(["A0", "B0"]);
  });

  it("counts evidence both branches found once, and charges it one slot", () => {
    const shared = candidate({ snippet: "both found this", kind: "web", url: "https://shared.example/x", score: 0.8 });
    const merged = mergeBranches([[shared, ...strong], [shared, ...weak]], 4);
    expect(merged.filter((e) => e.snippet === "both found this")).toHaveLength(1);
    expect(merged).toHaveLength(4);
  });

  it("gives the whole budget to the surviving branch when another is empty", () => {
    expect(mergeBranches([strong, []], 4)).toHaveLength(4);
  });

  it("handles more than two branches", () => {
    const third = [candidate({ snippet: "C0", kind: "knowledge", score: 0.5 })];
    const merged = mergeBranches([strong, weak, third], 3);
    expect(merged.map((e) => e.snippet)).toEqual(["A0", "B0", "C0"]);
  });

  it("returns nothing when there is nothing to merge", () => {
    expect(mergeBranches([], 5)).toEqual([]);
    expect(mergeBranches([[], []], 5)).toEqual([]);
  });
});

describe("citations", () => {
  it("extracts the tags a claim rests on", () => {
    expect(extractCitations("Demand is strong [E1] and growing [E12].")).toEqual(["E1", "E12"]);
    expect(extractCitations("No citation here.")).toEqual([]);
  });

  it("strips references to evidence that does not exist", () => {
    const known = new Set(["E1", "E2"]);
    expect(stripUnknownCitations("Real [E1] and invented [E9].", known)).toBe("Real [E1] and invented.");
  });

  it("measures grounding and flags invented references", () => {
    const stats = citationStats(["Cited claim [E1]", "Uncited claim", "Bad ref [E7]"], new Set(["E1", "E2"]));
    expect(stats.claims).toBe(3);
    expect(stats.cited).toBe(1);
    expect(stats.coverage).toBe(33);
    expect(stats.unknownRefs).toEqual(["E7"]);
  });

  it("reports zero coverage rather than dividing by zero on an empty solution", () => {
    expect(citationStats([], new Set(["E1"])).coverage).toBe(0);
  });
});

describe("prompt + planning fallbacks", () => {
  it("builds a citable evidence block with resolvable sources", () => {
    const block = evidenceBlock(
      numberEvidence([candidate({ snippet: "grew 22%", kind: "web", source: "Statista", url: "https://example.com/eu" })])
    );
    expect(block).toContain("[E1]");
    expect(block).toContain("Statista");
    expect(block).toContain("https://example.com/eu");
    expect(block).toContain("never invent");
  });

  it("returns nothing to cite when there is no evidence", () => {
    expect(evidenceBlock([])).toBe("");
  });

  it("falls back to the problem and its criteria when the planner is unavailable", () => {
    const plan = fallbackPlan("Enter the EU?", ["Name a first country", "Give a go/no-go"]);
    expect(plan[0].question).toBe("Enter the EU?");
    expect(plan.map((q) => q.question)).toContain("Name a first country");
    expect(plan.every((q) => q.queries.length > 0)).toBe(true);
  });
});

// The whole point of driving search/fetch ourselves: a web citation must point
// at a page that exists and really said it. The model never supplies a URL.
describe("web sourcing", () => {
  const org = { id: "org-1" } as Organization;
  const page = "x".repeat(500);

  function deps(over: Partial<WebDeps> = {}): WebDeps {
    return {
      search: async () => [{ title: "EU SaaS Report", url: "https://example.com/eu", snippet: "The market grew 22%." }],
      fetchPage: async () => ({ title: "EU SaaS Report 2025", text: page }),
      extract: async () => ["The EU SaaS market grew 22% in 2024."],
      ...over,
    };
  }

  it("attributes claims to the fetched page's real title and URL", async () => {
    const [item] = await gatherWeb(org, "How big is the EU SaaS market?", ["eu saas size"], deps());
    expect(item.url).toBe("https://example.com/eu");
    expect(item.source).toBe("EU SaaS Report 2025"); // from the fetch, not the model
    expect(item.snippet).toContain("22%");
    expect(item.kind).toBe("web");
  });

  it("keeps the real search snippet when a page will not load, rather than losing the source", async () => {
    const [item] = await gatherWeb(org, "q", ["q"], deps({ fetchPage: async () => { throw new Error("HTTP 403"); } }));
    expect(item.snippet).toBe("The market grew 22%.");
    expect(item.url).toBe("https://example.com/eu");
    expect(item.score).toBeLessThan(0.72); // an unfetched source is weaker
  });

  it("drops results whose URL does not resolve", async () => {
    const items = await gatherWeb(org, "q", ["q"], deps({ search: async () => [{ title: "Bad", url: "not-a-url", snippet: "x" }] }));
    expect(items).toEqual([]);
  });

  it("does not double-count the same page found by two different queries", async () => {
    const items = await gatherWeb(org, "q", ["query one", "query two"], deps());
    expect(items.filter((i) => i.url === "https://example.com/eu")).toHaveLength(1);
  });

  it("yields nothing when the page has no usable text", async () => {
    expect(await gatherWeb(org, "q", ["q"], deps({ fetchPage: async () => ({ title: "t", text: "short" }) }))).toEqual([]);
  });

  it("survives a search outage without failing the whole research run", async () => {
    const items = await gatherWeb(org, "q", ["q"], deps({ search: async () => { throw new Error("HTTP 403"); } }));
    expect(items).toEqual([]);
  });

  it("reports a gated page instead of citing it, and does not fall back to the search snippet", async () => {
    const blocked: { url: string; reason: string }[] = [];
    const items = await gatherWeb(
      org,
      "q",
      ["q"],
      deps({ fetchPage: async () => ({ title: "Just a moment...", text: "", blocked: { reason: "captcha", detail: "turnstile challenge present" } }) }),
      (b) => blocked.push(b)
    );
    // Nothing cited — we never write up a page we could not read.
    expect(items).toEqual([]);
    // But the source is accounted for, so "no evidence" is distinguishable
    // from "we couldn't get in".
    expect(blocked).toEqual([{ url: "https://example.com/eu", reason: "captcha", detail: "turnstile challenge present" }]);
  });
});
