import { describe, expect, it } from "vitest";

import {
  citationStats,
  dedupeEvidence,
  dedupeKey,
  evidenceBlock,
  extractCitations,
  fallbackPlan,
  gatherWeb,
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
});
