import { describe, expect, it } from "vitest";

import { DEFAULT_QUALITY, evaluateQualityGates, resolveQualityConfig, sectionPasses, type SectionIssue } from "./quality";

const minor: SectionIssue = { kind: "style", detail: "x", severity: "minor" };
const major: SectionIssue = { kind: "unsupported_claim", detail: "x", severity: "major" };
const blocking: SectionIssue = { kind: "contradiction", detail: "x", severity: "blocking" };

describe("sectionPasses", () => {
  it("passes with no or only minor issues by default", () => {
    expect(sectionPasses([], DEFAULT_QUALITY)).toBe(true);
    expect(sectionPasses([minor, minor], DEFAULT_QUALITY)).toBe(true);
  });
  it("fails on a blocking or a major issue by default", () => {
    expect(sectionPasses([blocking], DEFAULT_QUALITY)).toBe(false);
    expect(sectionPasses([major], DEFAULT_QUALITY)).toBe(false);
  });
  it("respects a higher major tolerance", () => {
    expect(sectionPasses([major], { ...DEFAULT_QUALITY, maxMajorIssues: 1 })).toBe(true);
  });
});

describe("evaluateQualityGates", () => {
  it("passes when every section is clean", () => {
    const g = evaluateQualityGates([{ id: "a", issues: [] }, { id: "b", issues: [minor] }], 0, DEFAULT_QUALITY);
    expect(g).toEqual({ passed: true, forced: false, sectionsToRevise: [] });
  });
  it("returns failing sections for another round below the cap", () => {
    const g = evaluateQualityGates([{ id: "a", issues: [major] }, { id: "b", issues: [] }], 0, DEFAULT_QUALITY);
    expect(g.passed).toBe(false);
    expect(g.forced).toBe(false);
    expect(g.sectionsToRevise).toEqual(["a"]);
  });
  it("forces completion at the iteration cap", () => {
    const g = evaluateQualityGates([{ id: "a", issues: [blocking] }], DEFAULT_QUALITY.maxIterations, DEFAULT_QUALITY);
    expect(g.passed).toBe(false);
    expect(g.forced).toBe(true);
    expect(g.sectionsToRevise).toEqual([]);
  });
});

describe("resolveQualityConfig", () => {
  it("falls back to defaults and applies overrides", () => {
    expect(resolveQualityConfig(undefined)).toEqual(DEFAULT_QUALITY);
    expect(resolveQualityConfig({ maxIterations: 4 }).maxIterations).toBe(4);
  });
});
