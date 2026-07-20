import { describe, expect, it } from "vitest";

import { generation, limits, retrieval } from "./generation";

describe("generation profiles", () => {
  it("keeps planning/summary/extract deterministic and work/chat more open", () => {
    // Determinism where consistency matters.
    expect(generation.plan.temperature).toBeLessThanOrEqual(0.35);
    expect(generation.summary.temperature).toBeLessThanOrEqual(0.35);
    expect(generation.extract.temperature).toBeLessThanOrEqual(0.3);
    // More room for open-ended generation.
    expect(generation.work.temperature).toBeGreaterThan(generation.plan.temperature);
    expect(generation.chat.temperature).toBeGreaterThanOrEqual(generation.work.temperature);
  });

  it("sizes token budgets for a capable ~27B model", () => {
    expect(generation.work.maxOutputTokens).toBeGreaterThanOrEqual(2000);
    expect(generation.plan.maxOutputTokens).toBeGreaterThan(0);
  });

  it("allows deeper projects and richer retrieval than a tiny-model default", () => {
    expect(retrieval.topK).toBeGreaterThanOrEqual(8);
    expect(limits.maxMilestones).toBeGreaterThanOrEqual(6);
    expect(limits.maxStageTasks).toBeGreaterThanOrEqual(4);
    expect(limits.maxSubtasks).toBeGreaterThanOrEqual(4);
  });
});
