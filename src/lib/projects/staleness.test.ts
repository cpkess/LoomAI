import { describe, expect, it } from "vitest";

import { isStale, staleItemIds } from "./staleness";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

function item(over: Partial<{ id: string; type: string; status: string; reviewedAt: Date }>) {
  return { id: "1", type: "assumption", status: "active", reviewedAt: daysAgo(0), ...over } as never;
}

describe("isStale", () => {
  it("flags an assumption past its 60-day interval", () => {
    expect(isStale(item({ type: "assumption", reviewedAt: daysAgo(61) }), now)).toBe(true);
    expect(isStale(item({ type: "assumption", reviewedAt: daysAgo(59) }), now)).toBe(false);
  });

  it("uses shorter intervals for risks than facts", () => {
    expect(isStale(item({ type: "risk", reviewedAt: daysAgo(31) }), now)).toBe(true);
    expect(isStale(item({ type: "fact", reviewedAt: daysAgo(31) }), now)).toBe(false);
  });

  it("only stales active or challenged items", () => {
    expect(isStale(item({ status: "resolved", reviewedAt: daysAgo(999) }), now)).toBe(false);
    expect(isStale(item({ status: "superseded", reviewedAt: daysAgo(999) }), now)).toBe(false);
    expect(isStale(item({ status: "challenged", type: "risk", reviewedAt: daysAgo(999) }), now)).toBe(true);
  });
});

describe("staleItemIds", () => {
  it("returns only the stale ids", () => {
    const items = [
      item({ id: "fresh", type: "assumption", reviewedAt: daysAgo(1) }),
      item({ id: "old", type: "assumption", reviewedAt: daysAgo(90) }),
      item({ id: "done", status: "resolved", reviewedAt: daysAgo(90) }),
    ];
    expect(staleItemIds(items, now)).toEqual(["old"]);
  });
});
