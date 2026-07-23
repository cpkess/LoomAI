import { describe, expect, it } from "vitest";

import { evidenceSchema, solutionModelSchema, type Problem } from "./solution";
import { solutionToDeck, solutionToMarkdown, solutionToOnePager, solutionToWorkbook } from "./solutionRender";

const evidence = evidenceSchema.parse([
  { id: "E1", snippet: "EU SaaS grew 22% in 2024", source: "https://example.com/eu", kind: "web" },
  { id: "E2", snippet: "40 leads in pipeline", source: "pipeline.xlsx", kind: "document", ref: "doc-1" },
]);

const problem: Problem = {
  coreProblem: "Whether to enter the EU market",
  whyItMatters: "It's the next growth lever",
  decision: "Build vs. buy vs. partner",
  solutionCriteria: ["Clear go/no-go", "Named first country"],
};

const model = solutionModelSchema.parse({
  title: "EU Market Entry",
  executiveSummary: "Enter via Germany with a local partner. Demand is strong. Regulatory bar is manageable.",
  recommendation: "Proceed with a partner-led entry in Germany in Q3.",
  findings: [{ title: "Strong demand", detail: "Pipeline of 40 enterprise leads." }],
  analysis: [{ point: "Germany has the lowest CAC", evidence: "From the market model" }],
  risks: [{ risk: "GDPR cost", mitigation: "Budget legal review" }],
  plan: [{ step: "Sign a partner", detail: "Shortlist 3", owner: "BD" }],
  metrics: [{ name: "TAM", value: "€2.1B", note: "2025" }],
});

describe("solution renderers — one source, consistent formats", () => {
  it("renders a full report with every section", () => {
    const md = solutionToMarkdown(problem, model);
    expect(md).toContain("# EU Market Entry");
    expect(md).toContain("## Recommendation");
    expect(md).toContain("Proceed with a partner-led entry in Germany");
    expect(md).toContain("Strong demand");
    expect(md).toContain("| TAM | €2.1B | 2025 |");
  });

  it("renders a one-pager that stays consistent with the report", () => {
    const one = solutionToOnePager(problem, model);
    expect(one).toContain("one-pager");
    // Same recommendation as the full report — they can't disagree.
    expect(one).toContain("Proceed with a partner-led entry in Germany in Q3.");
  });

  it("renders a deck spec whose title matches the model", () => {
    const deck = solutionToDeck(problem, model);
    expect(deck.title).toBe("EU Market Entry");
    const headings = deck.slides.map((s) => s.title);
    expect(headings).toEqual(expect.arrayContaining(["Executive summary", "Recommendation", "Findings", "Plan", "Key metrics"]));
  });

  it("renders a workbook spec with sheets for metrics/plan/risks/findings", () => {
    const wb = solutionToWorkbook(model);
    const names = wb.sheets.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Metrics", "Plan", "Risks", "Findings"]));
    const metrics = wb.sheets.find((s) => s.name === "Metrics")!;
    expect(metrics.rows[0]).toEqual(["TAM", "€2.1B", "2025"]);
  });

  it("adds a Sources section to every format when evidence is present", () => {
    const md = solutionToMarkdown(problem, model, evidence);
    expect(md).toContain("## Sources");
    expect(md).toContain("**[E1]**");
    expect(md).toContain("https://example.com/eu");

    const deck = solutionToDeck(problem, model, evidence);
    expect(deck.slides.map((s) => s.title)).toContain("Sources");

    const wb = solutionToWorkbook(model, evidence);
    const sources = wb.sheets.find((s) => s.name === "Sources")!;
    expect(sources.rows[0]).toEqual(["E1", "https://example.com/eu", "web", "EU SaaS grew 22% in 2024"]);
  });

  it("omits Sources when there's no evidence", () => {
    expect(solutionToMarkdown(problem, model)).not.toContain("## Sources");
  });

  it("degrades gracefully on an empty model", () => {
    const empty = solutionModelSchema.parse({});
    expect(() => solutionToMarkdown(null, empty)).not.toThrow();
    expect(solutionToWorkbook(empty).sheets.length).toBeGreaterThan(0);
    expect(solutionToDeck(null, empty).title).toBeTruthy();
  });
});
