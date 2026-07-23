import { describe, expect, it } from "vitest";

import { charterSchema, charterToSeedItems, normalizeKind, parseCharter } from "./scoping";

const full = {
  objective: "Enter the EU market",
  successCriteria: ["Signed 3 partners"],
  scope: { inScope: ["Germany"], outOfScope: ["US"] },
  audience: "Exec team",
  keyQuestions: ["Which country first?", "What is the regulatory bar?"],
  assumptions: ["Demand is growing"],
  risks: ["GDPR compliance cost"],
  approach: ["Research", "Draft strategy"],
  deliverables: [{ title: "EU Strategy", kind: "strategy", brief: "Go-to-market" }],
  evidenceNeeded: ["Market sizing"],
};

describe("charterSchema", () => {
  it("fills defaults for a sparse charter", () => {
    const c = charterSchema.parse({ objective: "x" });
    expect(c.objective).toBe("x");
    expect(c.keyQuestions).toEqual([]);
    expect(c.scope).toEqual({ inScope: [], outOfScope: [] });
    expect(c.deliverables).toEqual([]);
  });
  it("parses a full charter round-trip", () => {
    expect(charterSchema.parse(full).deliverables[0].kind).toBe("strategy");
  });
});

describe("parseCharter", () => {
  it("returns null for empty and a charter for valid input", () => {
    expect(parseCharter(null)).toBeNull();
    expect(parseCharter(full)?.objective).toBe("Enter the EU market");
  });
});

describe("normalizeKind", () => {
  it("keeps known kinds and falls back to report", () => {
    expect(normalizeKind("presentation")).toBe("presentation");
    expect(normalizeKind("workbook")).toBe("workbook");
    expect(normalizeKind("banana")).toBe("report");
  });
});

describe("charterToSeedItems", () => {
  it("seeds objective (decision), questions, assumptions, risks", () => {
    const seeds = charterToSeedItems(charterSchema.parse(full));
    const byType = (t: string) => seeds.filter((s) => s.type === t).map((s) => s.content);
    expect(byType("decision")).toEqual(["Objective: Enter the EU market"]);
    expect(byType("question")).toEqual(["Which country first?", "What is the regulatory bar?"]);
    expect(byType("assumption")).toEqual(["Demand is growing"]);
    expect(byType("risk")).toEqual(["GDPR compliance cost"]);
  });
  it("skips an empty objective", () => {
    const seeds = charterToSeedItems(charterSchema.parse({ keyQuestions: ["q"] }));
    expect(seeds.some((s) => s.type === "decision")).toBe(false);
    expect(seeds).toHaveLength(1);
  });
});
