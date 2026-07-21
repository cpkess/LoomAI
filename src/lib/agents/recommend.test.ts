import { describe, expect, it } from "vitest";

import { RECOMMENDATION_TYPES, isRecommendation, normalizeTitle } from "./recommend";

describe("isRecommendation", () => {
  it("recognizes recommendation action types", () => {
    expect(isRecommendation("recommend_project")).toBe(true);
    expect(isRecommendation("recommend_deliverable")).toBe(true);
  });

  it("rejects governance action types", () => {
    expect(isRecommendation("hire_employee")).toBe(false);
    expect(isRecommendation("create_department")).toBe(false);
  });

  it("covers every declared recommendation type", () => {
    for (const t of RECOMMENDATION_TYPES) expect(isRecommendation(t)).toBe(true);
  });
});

describe("normalizeTitle", () => {
  it("lowercases, trims, and collapses punctuation/whitespace for dedup", () => {
    expect(normalizeTitle("  Launch  LoomWidget 2.0! ")).toBe("launch loomwidget 2 0");
  });

  it("treats punctuation-only differences as equal", () => {
    expect(normalizeTitle("Go-to-market plan")).toBe(normalizeTitle("Go to market plan"));
  });

  it("distinguishes genuinely different titles", () => {
    expect(normalizeTitle("Hiring plan")).not.toBe(normalizeTitle("Marketing plan"));
  });
});
