import { describe, expect, it } from "vitest";

import { fitDimensions } from "./embed";

describe("fitDimensions", () => {
  it("returns the vector unchanged when it matches", () => {
    const v = [1, 2, 3];
    expect(fitDimensions(v, 3)).toBe(v);
  });

  it("zero-pads short vectors", () => {
    expect(fitDimensions([1, 2], 4)).toEqual([1, 2, 0, 0]);
  });

  it("truncates long vectors", () => {
    expect(fitDimensions([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });
});
