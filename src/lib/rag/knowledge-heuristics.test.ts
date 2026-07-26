import { describe, expect, it } from "vitest";

import { deriveTitle, isKnowledgeCandidate } from "./knowledge-heuristics";

const long = (s: string) => s.repeat(Math.ceil(220 / s.length));

describe("isKnowledgeCandidate", () => {
  it("rejects short outputs", () => {
    expect(isKnowledgeCandidate("Done.")).toBe(false);
    expect(isKnowledgeCandidate("")).toBe(false);
  });

  it("accepts a substantial deliverable", () => {
    const text =
      "# Launch checklist\n\nBefore shipping LoomWidget 2.0 the team must: finalize the scope document, " +
      "complete a full QA pass across supported browsers, prepare release notes for customers, and schedule " +
      "the production deploy window with on-call coverage. Each step has an owner and a due date.";
    expect(isKnowledgeCandidate(text)).toBe(true);
  });

  it("rejects a short failure/refusal", () => {
    expect(isKnowledgeCandidate("I cannot complete this task because the data is missing. " + "Please advise.")).toBe(
      false
    );
  });

  it("rejects a lone question", () => {
    expect(isKnowledgeCandidate("Could you clarify which market segment you mean for the analysis here please?")).toBe(
      false
    );
  });

  it("rejects near-empty markdown noise", () => {
    expect(isKnowledgeCandidate(long("## - * "))).toBe(false);
  });
});

describe("deriveTitle", () => {
  it("uses a markdown H1", () => {
    expect(deriveTitle("# Q3 Revenue Plan\n\nDetails follow.", "fallback")).toBe("Q3 Revenue Plan");
  });

  it("uses a bold lead-in", () => {
    expect(deriveTitle("**Hiring policy** applies to all AI employees.", "fallback")).toBe("Hiring policy");
  });

  it("falls back to the first sentence", () => {
    expect(deriveTitle("The launch is scheduled for March. More below.", "fallback")).toBe(
      "The launch is scheduled for March."
    );
  });

  it("uses the fallback when content has no usable lead", () => {
    expect(deriveTitle("...", "My Fallback")).toBe("My Fallback");
  });

  it("clamps very long titles", () => {
    const title = deriveTitle(`# ${"word ".repeat(60)}`, "fallback");
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
  });
});
